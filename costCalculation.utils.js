/**
 * Utilitaires de calcul de coût de revient et d'économies réelles
 * Basé sur des données importées (pas de fixtures)
 */

/**
 * Calcule le coût de revient exact d'un produit final
 * basé sur la fiche technique et les coûts importés des ingrédients
 *
 * @param {Object} product - Produit final { id, name, recipe: [{ingredientId, quantityUsed}, ...] }
 * @param {Array} ingredientsList - Liste de tous les ingrédients avec costs { id, name, cost_per_unit, unit }
 * @returns {number} Coût de revient total du produit en euros
 */
export const calculateProductCost = (product, ingredientsList) => {
  if (!product || !product.recipe || product.recipe.length === 0) {
    return 0;
  }

  let totalCost = 0;

  product.recipe.forEach((recipeItem) => {
    const ingredient = ingredientsList.find((ing) => ing.id === recipeItem.ingredientId);

    if (!ingredient) {
      console.warn(
        `Ingrédient ${recipeItem.ingredientId} non trouvé pour le produit ${product.name}`
      );
      return;
    }

    // Calcul : quantité utilisée × coût unitaire
    const itemCost = recipeItem.quantityUsed * ingredient.cost_per_unit;
    totalCost += itemCost;
  });

  return Math.round(totalCost * 100) / 100; // Arrondir à 2 décimales
};

/**
 * Calcule les économies réelles évitées par les prévisions "À Point"
 *
 * Formule stricte :
 * Pour chaque produit : (Moyenne habituelle - Prévision À Point) × Coût de revient
 * Additionne pour la semaine
 *
 * @param {Object} forecastData - Prévisions "À Point" { productId: quantity, ... }
 * @param {Object} historicalData - Historique des 4-8 dernières semaines { productId: [qty1, qty2, ...], ... }
 * @param {Object} productCosts - Coûts de revient { productId: cost, ... }
 * @returns {Object} { totalSavings, breakdown: [{productId, habitualAvg, forecast, wasteAvoided, savingsAmount}, ...] }
 */
export const calculateAvoidedWaste = (forecastData, historicalData, productCosts) => {
  if (!forecastData || Object.keys(forecastData).length === 0) {
    return {
      totalSavings: 0,
      breakdown: [],
      hasData: false,
    };
  }

  const breakdown = [];
  let totalSavings = 0;

  Object.entries(forecastData).forEach(([productId, forecastQty]) => {
    // Calcule la moyenne habituelle de production pour ce produit
    const historicalQtys = historicalData[productId] || [];
    if (historicalQtys.length === 0) {
      console.warn(`Aucune donnée historique pour le produit ${productId}`);
      return;
    }

    const habitualAvg = historicalQtys.reduce((sum, qty) => sum + qty, 0) / historicalQtys.length;
    const productCost = productCosts[productId] || 0;

    // Calcule le gaspillage évité
    // Positif = À Point prévoit MOINS que d'habitude (moins de surproduction)
    const wasteAvoided = Math.max(0, habitualAvg - forecastQty);
    const savingsAmount = wasteAvoided * productCost;

    if (savingsAmount > 0) {
      breakdown.push({
        productId,
        habitualAvg: Math.round(habitualAvg * 100) / 100,
        forecast: forecastQty,
        wasteAvoided: Math.round(wasteAvoided * 100) / 100,
        savingsAmount: Math.round(savingsAmount * 100) / 100,
      });

      totalSavings += savingsAmount;
    }
  });

  return {
    totalSavings: Math.round(totalSavings * 100) / 100,
    breakdown,
    hasData: true,
  };
};

/**
 * Récupère les historiques de vente pour une période donnée
 * (À intégrer avec Supabase pour les données réelles)
 *
 * @param {string} productId - ID du produit
 * @param {string} startDate - Date de début (ISO string)
 * @param {string} endDate - Date de fin (ISO string)
 * @param {Object} supabaseClient - Client Supabase
 * @returns {Promise<Array>} Array de quantités vendues
 */
export const fetchHistoricalData = async (productId, startDate, endDate, supabaseClient) => {
  if (!supabaseClient) {
    console.warn('Supabase client non fourni. Utilisation de données vides.');
    return [];
  }

  try {
    const { data, error } = await supabaseClient
      .from('ventes')
      .select('quantite')
      .eq('produit_id', productId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true });

    if (error) {
      console.error('Erreur lors de la récupération de l\'historique:', error);
      return [];
    }

    return data.map((row) => row.quantite);
  } catch (error) {
    console.error('Erreur lors du fetch historique:', error);
    return [];
  }
};

/**
 * Vérifie si suffisamment de données sont disponibles pour calculer les économies
 */
export const hasSufficientData = (ingredientsList, productsList, forecastData, historicalData) => {
  const hasIngredients = ingredientsList && ingredientsList.length > 0;
  const hasProducts = productsList && productsList.length > 0;
  const hasForecast = forecastData && Object.keys(forecastData).length > 0;
  const hasHistory = historicalData && Object.values(historicalData).some((arr) => arr.length > 0);

  return hasIngredients && hasProducts && hasForecast && hasHistory;
};

export default {
  calculateProductCost,
  calculateAvoidedWaste,
  fetchHistoricalData,
  hasSufficientData,
};
