const Product = require("../models/Product");
const History = require("../models/History");
const Suggestion = require("../models/Suggestion");

class AISuggestionEngine {
  /**
   * Generate all AI suggestions for a user
   * @param {string} userId - The user's ID
   * @returns {Array} - Array of suggestion objects
   */
  async generateSuggestions(userId) {
    const products = await Product.find({ userId });
    const history = await History.find({ userId }).sort({ createdAt: -1 });

    const suggestions = [];

    // Run all analysis engines
    suggestions.push(...this.analyzeReorderNeeds(products, history));
    suggestions.push(...this.identifyDeadStock(products, history));
    suggestions.push(...this.identifyFastMovers(products, history));
    suggestions.push(...this.analyzePricing(products, history));
    suggestions.push(...this.detectSeasonalTrends(products, history));
    suggestions.push(...this.suggestBundles(products, history));
    suggestions.push(...this.identifyClearanceCandidates(products, history));
    suggestions.push(...this.analyzeTrends(products, history));
    suggestions.push(...this.recommendProductFocus(products, history));

    // Sort by priority (high > medium > low)
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    // Save/update suggestions in database to persist dismissal state
    await this.saveSuggestions(userId, suggestions);

    // Return saved suggestions with _id from database (only non-dismissed)
    const savedSuggestions = await Suggestion.find({
      userId,
      dismissed: false
    }).sort({ createdAt: -1 });

    // Custom priority sorting: high -> medium -> low
    savedSuggestions.sort((a, b) => {
      return (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3);
    });

    return savedSuggestions;
  }

  /**
   * Save generated suggestions to database
   * @param {string} userId - The user's ID
   * @param {Array} suggestions - Array of generated suggestion objects
   */
  async saveSuggestions(userId, suggestions) {
    // Get existing non-dismissed suggestions
    const existingSuggestions = await Suggestion.find({ 
      userId, 
      dismissed: false 
    });

    // Create a map of existing suggestions by type+productName for matching
    const existingMap = new Map();
    existingSuggestions.forEach(s => {
      const key = `${s.type}_${s.productName || 'general'}`;
      existingMap.set(key, s);
    });

    // Update or insert suggestions
    for (const suggestion of suggestions) {
      const key = `${suggestion.type}_${suggestion.productName || 'general'}`;
      const existing = existingMap.get(key);

      if (existing) {
        // Update existing suggestion with new data but preserve dismissal state
        await Suggestion.findByIdAndUpdate(existing._id, {
          $set: {
            title: suggestion.title,
            description: suggestion.description,
            action: suggestion.action,
            impact: suggestion.impact,
            data: suggestion.data,
            priority: suggestion.priority
          }
        });
      } else {
        // Insert new suggestion
        await Suggestion.create({
          ...suggestion,
          userId
        });
      }
    }

    // Mark suggestions that are no longer generated as dismissed (stale)
    const currentKeys = new Set(suggestions.map(s => 
      `${s.type}_${s.productName || 'general'}`
    ));

    for (const existing of existingSuggestions) {
      const key = `${existing.type}_${existing.productName || 'general'}`;
      if (!currentKeys.has(key)) {
        // This suggestion is no longer relevant
        await Suggestion.findByIdAndUpdate(existing._id, {
          $set: { dismissed: true }
        });
      }
    }
  }

  /**
   * 1. REORDER SUGGESTIONS - Products running low fast
   */
  analyzeReorderNeeds(products, history) {
    const suggestions = [];

    products.forEach(product => {
      if (product.quantity <= product.minStock) {
        // Calculate consumption rate from history
        const productHistory = history.filter(h => h.name === product.name);
        const additions = productHistory.filter(h => h.change.startsWith('+'));
        const subtractions = productHistory.filter(h => h.change.startsWith('-'));

        let totalSubtracted = 0;
        subtractions.forEach(h => {
          totalSubtracted += Math.abs(parseInt(h.change) || 0);
        });

        // Calculate days of data
        const daysDiff = history.length > 0 
          ? Math.max(1, (new Date() - new Date(history[history.length - 1].createdAt)) / (1000 * 60 * 60 * 24))
          : 1;

        const dailyConsumption = totalSubtracted / daysDiff;
        const daysUntilEmpty = dailyConsumption > 0 ? product.quantity / dailyConsumption : Infinity;

        if (daysUntilEmpty < 7) {
          suggestions.push({
            type: 'reorder',
            priority: 'high',
            title: `🚨 Urgent: ${product.name} will run out in ${Math.round(daysUntilEmpty)} days`,
            description: `Based on consumption rate of ${dailyConsumption.toFixed(1)} units/day, you'll run out of ${product.name} soon. Current stock: ${product.quantity}, Min threshold: ${product.minStock}`,
            action: `Order at least ${Math.ceil(dailyConsumption * 14)} units to cover 2 weeks`,
            impact: `Prevents stockout and potential lost sales`,
            productName: product.name,
            data: {
              currentStock: product.quantity,
              minStock: product.minStock,
              dailyConsumption: dailyConsumption.toFixed(1),
              daysUntilEmpty: Math.round(daysUntilEmpty),
              suggestedOrderQty: Math.ceil(dailyConsumption * 14)
            }
          });
        } else if (product.quantity <= product.minStock) {
          suggestions.push({
            type: 'reorder',
            priority: 'medium',
            title: `⚠️ ${product.name} is below minimum stock`,
            description: `Current quantity (${product.quantity}) is below your minimum threshold (${product.minStock}). Consider restocking soon.`,
            action: `Reorder to reach at least ${product.minStock * 2} units`,
            impact: `Maintains healthy stock levels`,
            productName: product.name,
            data: {
              currentStock: product.quantity,
              minStock: product.minStock,
              suggestedOrderQty: product.minStock * 2 - product.quantity
            }
          });
        }
      }
    });

    return suggestions;
  }

  /**
   * 2. DEAD STOCK - Products with no movement
   */
  identifyDeadStock(products, history) {
    const suggestions = [];

    products.forEach(product => {
      const productHistory = history.filter(h => h.name === product.name);
      
      if (productHistory.length === 0 && product.quantity > 0) {
        const daysSinceAdded = Math.max(1, (new Date() - new Date(product.createdAt)) / (1000 * 60 * 60 * 24));
        
        if (daysSinceAdded > 30) {
          const tiedUpCapital = product.quantity * product.price;
          suggestions.push({
            type: 'dead_stock',
            priority: 'medium',
            title: `📦 ${product.name} has zero movement in ${Math.round(daysSinceAdded)} days`,
            description: `This product was added ${Math.round(daysSinceAdded)} days ago and hasn't had any stock movements. You have ${product.quantity} units worth ₹${tiedUpCapital.toLocaleString()} tied up.`,
            action: `Consider discounting by 20-30% or bundling with popular items`,
            impact: `Frees up ₹${tiedUpCapital.toLocaleString()} in capital and storage space`,
            productName: product.name,
            data: {
              quantity: product.quantity,
              tiedUpCapital,
              daysSinceAdded: Math.round(daysSinceAdded),
              suggestedDiscount: 25
            }
          });
        }
      } else if (productHistory.length > 0) {
        // Check if last movement was long ago
        const lastMovement = productHistory[0];
        const daysSinceMovement = Math.max(1, (new Date() - new Date(lastMovement.createdAt)) / (1000 * 60 * 60 * 24));
        
        if (daysSinceMovement > 60 && product.quantity > 0) {
          const tiedUpCapital = product.quantity * product.price;
          suggestions.push({
            type: 'dead_stock',
            priority: 'low',
            title: `📦 ${product.name} inactive for ${Math.round(daysSinceMovement)} days`,
            description: `Last activity was ${Math.round(daysSinceMovement)} days ago. You still have ${product.quantity} units in stock.`,
            action: `Review if this product should remain in inventory`,
            impact: `Optimize inventory and reduce holding costs`,
            productName: product.name,
            data: {
              quantity: product.quantity,
              tiedUpCapital,
              daysSinceLastMovement: Math.round(daysSinceMovement)
            }
          });
        }
      }
    });

    return suggestions;
  }

  /**
   * 3. FAST MOVERS - High velocity products
   */
  identifyFastMovers(products, history) {
    const suggestions = [];
    const movements = {};

    history.forEach(entry => {
      const name = entry.name;
      if (!movements[name]) {
        movements[name] = { totalMoved: 0, transactions: 0 };
      }
      
      let moved = 0;
      if (entry.change.startsWith('+')) {
        moved = parseInt(entry.change.replace('+', '')) || 0;
      } else if (entry.change.startsWith('-')) {
        moved = Math.abs(parseInt(entry.change.replace('-', '')) || 0);
      }
      
      movements[name].totalMoved += moved;
      movements[name].transactions += 1;
    });

    // Find top fast movers
    const topMovers = Object.entries(movements)
      .filter(([_, data]) => data.transactions >= 3) // At least 3 transactions
      .sort((a, b) => b[1].totalMoved - a[1].totalMoved)
      .slice(0, 5);

    topMovers.forEach(([name, data]) => {
      const product = products.find(p => p.name === name);
      if (product) {
        suggestions.push({
          type: 'fast_mover',
          priority: 'high',
          title: `🔥 ${name} is a fast mover (${data.transactions} transactions)`,
          description: `${name} has moved ${data.totalMoved} units across ${data.transactions} transactions. This is one of your most active products.`,
          action: `Consider increasing stock buffer to ${Math.ceil(product.minStock * 1.5)} and negotiating bulk purchase discounts`,
          impact: `Maximize revenue on high-demand product`,
          productName: name,
          data: {
            totalMoved: data.totalMoved,
            transactions: data.transactions,
            avgTransactionSize: Math.round(data.totalMoved / data.transactions)
          }
        });
      }
    });

    return suggestions;
  }

  /**
   * 4. PRICING INSIGHTS - Revenue optimization
   */
  analyzePricing(products, history) {
    const suggestions = [];
    const totalValue = products.reduce((sum, p) => sum + (p.quantity * p.price), 0);
    const avgPrice = products.length > 0 ? totalValue / products.reduce((sum, p) => sum + p.quantity, 1) : 0;

    // Find products priced significantly above/below average
    products.forEach(product => {
      const productValue = product.quantity * product.price;
      const priceDiff = ((product.price - avgPrice) / avgPrice) * 100;

      if (priceDiff > 50 && product.quantity > 10) {
        suggestions.push({
          type: 'pricing',
          priority: 'medium',
          title: `💰 ${product.name} is priced ${Math.round(priceDiff)}% above average`,
          description: `At ₹${product.price} per unit, this product is significantly above your average of ₹${avgPrice.toFixed(2)}. Current stock value: ₹${productValue.toLocaleString()}.`,
          action: `Monitor sales velocity. If moving slowly, consider price reduction. If fast, maintain or increase.`,
          impact: `Optimize profit margins`,
          productName: product.name,
          data: {
            currentPrice: product.price,
            avgPrice: avgPrice.toFixed(2),
            priceDifference: Math.round(priceDiff),
            totalValue: productValue
          }
        });
      }
    });

    // Overall pricing recommendation
    if (products.length > 5) {
      suggestions.push({
        type: 'pricing',
        priority: 'low',
        title: `📊 Review pricing strategy for portfolio`,
        description: `You have ${products.length} products with total inventory value of ₹${totalValue.toLocaleString()}. Consider implementing tiered pricing (budget, standard, premium) to capture different customer segments.`,
        action: `Categorize products into 3 price tiers and adjust margins accordingly`,
        impact: `Potential 10-15% revenue increase with optimized pricing`,
        data: {
          totalInventoryValue: totalValue,
          productCount: products.length,
          avgPrice: avgPrice.toFixed(2)
        }
      });
    }

    return suggestions;
  }

  /**
   * 5. SEASONAL TRENDS - Time-based patterns
   */
  detectSeasonalTrends(products, history) {
    const suggestions = [];
    
    if (history.length < 10) return suggestions; // Need enough data

    // Group by month
    const monthlyData = {};
    history.forEach(entry => {
      const date = new Date(entry.createdAt);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { transactions: 0, totalMoved: 0 };
      }
      monthlyData[monthKey].transactions += 1;
      
      let moved = 0;
      if (entry.change.startsWith('+') || entry.change.startsWith('-')) {
        moved = Math.abs(parseInt(entry.change) || 0);
      }
      monthlyData[monthKey].totalMoved += moved;
    });

    const months = Object.entries(monthlyData).sort((a, b) => a[0].localeCompare(b[0]));
    
    if (months.length >= 3) {
      // Find peak and low months
      const peakMonth = months.reduce((max, m) => m[1].transactions > max[1].transactions ? m : max, months[0]);
      const lowMonth = months.reduce((min, m) => m[1].transactions < min[1].transactions ? m : min, months[0]);

      const currentMonth = new Date().toISOString().slice(0, 7);
      
      suggestions.push({
        type: 'seasonal',
        priority: 'medium',
        title: `📅 Seasonal pattern detected`,
        description: `Your busiest month was ${peakMonth[0]} with ${peakMonth[1].transactions} transactions. Slowest was ${lowMonth[0]} with ${lowMonth[1].transactions} transactions.`,
        action: `Plan inventory buildup 2-3 weeks before peak months. Reduce orders during slow periods.`,
        impact: `Better stock availability during high-demand periods`,
        data: {
          peakMonth: peakMonth[0],
          peakTransactions: peakMonth[1].transactions,
          lowMonth: lowMonth[0],
          lowTransactions: lowMonth[1].transactions
        }
      });
    }

    return suggestions;
  }

  /**
   * 6. BUNDLE SUGGESTIONS - Products that move together
   */
  suggestBundles(products, history) {
    const suggestions = [];

    if (history.length < 5) return suggestions;

    // Find products frequently updated in same time window
    const timeWindows = {};
    history.forEach(entry => {
      // Group by day
      const dayKey = new Date(entry.createdAt).toDateString();
      if (!timeWindows[dayKey]) {
        timeWindows[dayKey] = new Set();
      }
      timeWindows[dayKey].add(entry.name);
    });

    // Find co-occurring products
    const coOccurrences = {};
    Object.values(timeWindows).forEach(productsInDay => {
      if (productsInDay.size >= 2) {
        const productsArray = Array.from(productsInDay);
        for (let i = 0; i < productsArray.length; i++) {
          for (let j = i + 1; j < productsArray.length; j++) {
            const key = [productsArray[i], productsArray[j]].sort().join(' + ');
            coOccurrences[key] = (coOccurrences[key] || 0) + 1;
          }
        }
      }
    });

    // Find top bundles
    const topBundles = Object.entries(coOccurrences)
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    topBundles.forEach(([bundle, count]) => {
      suggestions.push({
        type: 'bundle',
        priority: 'low',
        title: `🎁 Bundle opportunity: ${bundle}`,
        description: `These products are often updated together (${count} times). Consider offering them as a bundle with a 10-15% discount.`,
        action: `Create a bundle deal to increase average order value`,
        impact: `Higher customer satisfaction and increased sales`,
        data: {
          coOccurrenceCount: count,
          products: bundle.split(' + ')
        }
      });
    });

    return suggestions;
  }

  /**
   * 7. CLEARANCE CANDIDATES - Overstocked items
   */
  identifyClearanceCandidates(products, history) {
    const suggestions = [];

    products.forEach(product => {
      if (product.quantity > product.minStock * 3) {
        const productHistory = history.filter(h => h.name === product.name);
        const recentSubtractions = productHistory
          .filter(h => h.change.startsWith('-'))
          .slice(0, 10);

        let totalSubtracted = 0;
        recentSubtractions.forEach(h => {
          totalSubtracted += Math.abs(parseInt(h.change) || 0);
        });

        const avgWithdrawal = recentSubtractions.length > 0 
          ? totalSubtracted / recentSubtractions.length 
          : 0;

        const monthsToSellout = avgWithdrawal > 0 
          ? product.quantity / (avgWithdrawal * 30) 
          : Infinity;

        if (monthsToSellout > 6) {
          const excessValue = (product.quantity - product.minStock) * product.price;
          suggestions.push({
            type: 'clearance',
            priority: 'low',
            title: `🏷️ ${product.name} is overstocked (${product.quantity} units)`,
            description: `At current sales rate, it will take ${Math.round(monthsToSellout)} months to sell current stock. You have ₹${excessValue.toLocaleString()} in excess inventory.`,
            action: `Run a clearance sale with 30-40% discount to free up space and capital`,
            impact: `Recover ₹${Math.round(excessValue * 0.6).toLocaleString()} and reduce holding costs`,
            productName: product.name,
            data: {
              currentStock: product.quantity,
              minStock: product.minStock,
              excessStock: product.quantity - product.minStock,
              excessValue,
              monthsToSellout: Math.round(monthsToSellout)
            }
          });
        }
      }
    });

    return suggestions;
  }

  /**
   * 8. TREND ANALYSIS - Growing/declining products
   */
  analyzeTrends(products, history) {
    const suggestions = [];

    if (history.length < 20) return suggestions;

    // Split history into two halves and compare
    const midPoint = Math.floor(history.length / 2);
    const recentHistory = history.slice(0, midPoint);
    const olderHistory = history.slice(midPoint);

    const recentActivity = {};
    const olderActivity = {};

    recentHistory.forEach(h => {
      recentActivity[h.name] = (recentActivity[h.name] || 0) + 1;
    });

    olderHistory.forEach(h => {
      olderActivity[h.name] = (olderActivity[h.name] || 0) + 1;
    });

    // Find trending products
    Object.keys(recentActivity).forEach(name => {
      const recent = recentActivity[name] || 0;
      const older = olderActivity[name] || 0;
      const change = older > 0 ? ((recent - older) / older) * 100 : 100;

      if (change > 50 && recent >= 3) {
        suggestions.push({
          type: 'trend',
          priority: 'high',
          title: `📈 ${name} is trending up (${Math.round(change)}% increase)`,
          description: `Activity for ${name} increased from ${older} to ${recent} transactions. This product is gaining momentum.`,
          action: `Increase stock levels and consider marketing this product more aggressively`,
          impact: `Capitalize on growing demand`,
          productName: name,
          data: {
            recentTransactions: recent,
            olderTransactions: older,
            growthPercentage: Math.round(change)
          }
        });
      }
    });

    return suggestions;
  }

  /**
   * 9. PRODUCT FOCUS RECOMMENDATIONS - Which products to focus on
   */
  recommendProductFocus(products, history) {
    const suggestions = [];

    if (products.length === 0) return suggestions;

    // Calculate metrics for each product
    const productMetrics = products.map(product => {
      const productHistory = history.filter(h => h.name === product.name);
      
      // Calculate movement metrics
      const additions = productHistory.filter(h => h.change.startsWith('+'));
      const subtractions = productHistory.filter(h => h.change.startsWith('-'));
      
      let totalAdded = 0, totalSubtracted = 0;
      additions.forEach(h => totalAdded += parseInt(h.change.replace('+', '')) || 0);
      subtractions.forEach(h => totalSubtracted += Math.abs(parseInt(h.change.replace('-', '')) || 0));
      
      const totalValue = product.quantity * product.price;
      const turnoverRate = product.quantity > 0 ? (totalSubtracted / product.quantity) : 0;
      const activityScore = productHistory.length;
      
      // Calculate opportunity score (0-100)
      let opportunityScore = 0;
      
      // High turnover = good demand (30 points max)
      opportunityScore += Math.min(30, turnoverRate * 10);
      
      // High activity = more attention (25 points max)
      opportunityScore += Math.min(25, activityScore * 2);
      
      // High value products deserve focus (20 points max)
      const maxProductValue = Math.max(...products.map(p => p.quantity * p.price), 1);
      opportunityScore += 20 * (totalValue / maxProductValue);
      
      // Growth trend (25 points max)
      if (productHistory.length >= 2) {
        const recent = productHistory.slice(0, Math.floor(productHistory.length / 2)).length;
        const older = productHistory.slice(Math.floor(productHistory.length / 2)).length;
        if (older > 0 && recent > older) {
          opportunityScore += 25;
        } else if (older > 0) {
          opportunityScore += 12 * (recent / older);
        }
      }
      
      return {
        product,
        metrics: {
          totalAdded,
          totalSubtracted,
          totalValue,
          turnoverRate: turnoverRate.toFixed(2),
          activityScore,
          opportunityScore: Math.min(100, Math.round(opportunityScore)),
          transactionCount: productHistory.length
        }
      };
    });

    // Sort by opportunity score
    productMetrics.sort((a, b) => b.metrics.opportunityScore - a.metrics.opportunityScore);

    // TOP 3 products to focus on (high opportunity)
    const topProducts = productMetrics.slice(0, Math.min(3, productMetrics.length));
    topProducts.forEach(({ product, metrics }) => {
      if (metrics.opportunityScore >= 50) {
        suggestions.push({
          type: 'trend',
          priority: 'high',
          title: `🎯 Focus on ${product.name} (Opportunity Score: ${metrics.opportunityScore}/100)`,
          description: `This is your strongest product with ${metrics.transactionCount} transactions, ₹${metrics.totalValue.toLocaleString()} in stock value, and ${metrics.turnoverRate}x turnover rate. It deserves more investment and attention.`,
          action: `Increase stock buffer to ${Math.ceil(product.minStock * 2)}, consider bulk purchasing discounts, and feature this product prominently`,
          impact: `Maximize returns on your best-performing product`,
          productName: product.name,
          data: {
            opportunityScore: metrics.opportunityScore,
            totalValue: metrics.totalValue,
            turnoverRate: metrics.turnoverRate,
            transactions: metrics.transactionCount,
            recommendation: 'INCREASE_INVESTMENT'
          }
        });
      }
    });

    // BOTTOM 3 products to reconsider (low opportunity)
    const bottomProducts = productMetrics.slice(-Math.min(3, productMetrics.length)).reverse();
    bottomProducts.forEach(({ product, metrics }) => {
      if (metrics.opportunityScore < 30 && product.quantity > 0) {
        const tiedCapital = product.quantity * product.price;
        
        let reason = '';
        if (metrics.transactionCount === 0) {
          reason = 'Zero transaction history';
        } else if (metrics.turnoverRate < 0.5) {
          reason = `Very low turnover (${metrics.turnoverRate}x)`;
        } else {
          reason = 'Low overall performance';
        }
        
        suggestions.push({
          type: 'dead_stock',
          priority: 'medium',
          title: `⚠️ Reconsider ${product.name} (Opportunity Score: ${metrics.opportunityScore}/100)`,
          description: `${reason}. This product has ₹${tiedCapital.toLocaleString()} tied up in inventory with minimal activity. Consider if this product deserves continued investment.`,
          action: `Either discontinue, liquidate at discount, or drastically reduce stock levels to free up ₹${tiedCapital.toLocaleString()}`,
          impact: `Reallocate capital to higher-performing products`,
          productName: product.name,
          data: {
            opportunityScore: metrics.opportunityScore,
            tiedCapital,
            turnoverRate: metrics.turnoverRate,
            transactions: metrics.transactionCount,
            recommendation: 'REDUCE_OR_DISCONTINUE'
          }
        });
      }
    });

    // PORTFOLIO SUMMARY - Overall recommendation
    if (products.length >= 5) {
      const avgScore = productMetrics.reduce((sum, p) => sum + p.metrics.opportunityScore, 0) / productMetrics.length;
      const highPerformers = productMetrics.filter(p => p.metrics.opportunityScore >= 60).length;
      const lowPerformers = productMetrics.filter(p => p.metrics.opportunityScore < 30).length;
      
      let portfolioAdvice = '';
      if (avgScore >= 60) {
        portfolioAdvice = 'Your portfolio is strong. Most products show good activity. Consider expanding your best performers.';
      } else if (avgScore >= 40) {
        portfolioAdvice = `Moderate portfolio health. ${highPerformers} products performing well, ${lowPerformers} underperforming. Focus on the top performers and reconsider the bottom ones.`;
      } else {
        portfolioAdvice = `Portfolio needs attention. ${lowPerformers} products showing low activity. Consider pruning weak products and investing more in strong ones.`;
      }
      
      suggestions.push({
        type: 'pricing',
        priority: 'low',
        title: `📊 Portfolio Health: ${avgScore >= 50 ? 'Healthy' : 'Needs Work'} (Avg Score: ${Math.round(avgScore)}/100)`,
        description: `You have ${products.length} products. ${highPerformers} are high-performers, ${lowPerformers} are underperformers. ${portfolioAdvice}`,
        action: `Aim for 70%+ of products scoring above 50. Consider the 80/20 rule - 20% of products likely generate 80% of your results`,
        impact: `Optimize product mix for maximum profitability`,
        data: {
          totalProducts: products.length,
          avgScore: Math.round(avgScore),
          highPerformers,
          lowPerformers,
          topProduct: topProducts[0]?.product.name,
          recommendation: 'PORTFOLIO_OPTIMIZATION'
        }
      });
    }

    return suggestions;
  }
}

module.exports = new AISuggestionEngine();
