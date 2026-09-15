/**
 * Utilitaire de parsing CSV/Excel pour les fiches techniques
 * Détecte automatiquement la colonne "prix" et la stocke dans le state
 */

/**
 * Normalize une chaîne de texte pour la comparaison de colonnes
 * (ex: "Prix au kg", "Prix unitaire", "Coût" → tous détectés)
 */
const normalizePriceColumnName = (columnName) => {
  if (!columnName) return '';
  return columnName
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, '');
};

/**
 * Détecte le nom de la colonne "prix" dans un tableau d'en-têtes
 * Cherche: "prix", "prixunitaire", "coutau", "coutrevient", "coût", etc.
 */
export const detectPriceColumn = (headers) => {
  const priceKeywords = ['prix', 'cout', 'coût', 'cost', 'price', 'prixunitaire', 'coutrevient'];

  const priceColumnIndex = headers.findIndex((header) => {
    const normalized = normalizePriceColumnName(header);
    return priceKeywords.some((keyword) => normalized.includes(keyword));
  });

  return priceColumnIndex !== -1 ? priceColumnIndex : null;
};

/**
 * Parse un fichier CSV et retourne un tableau d'ingrédients avec prix
 * Format attendu : chaque ligne = { name, quantity, unit, cost_per_unit }
 */
export const parseIngredientsCSV = (csvText) => {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) {
    throw new Error('Le fichier CSV doit contenir au moins une en-tête et une ligne de données');
  }

  // Parse la première ligne comme en-tête
  const headers = lines[0].split(',').map((h) => h.trim());

  // Cherche les colonnes clés
  const nameColumnIndex = headers.findIndex(
    (h) => normalizePriceColumnName(h).includes('nom') || 
           normalizePriceColumnName(h).includes('ingredient') ||
           normalizePriceColumnName(h).includes('name')
  );

  const quantityColumnIndex = headers.findIndex(
    (h) => normalizePriceColumnName(h).includes('quantite') ||
           normalizePriceColumnName(h).includes('qty') ||
           normalizePriceColumnName(h).includes('quantity')
  );

  const unitColumnIndex = headers.findIndex(
    (h) => normalizePriceColumnName(h).includes('unite') ||
           normalizePriceColumnName(h).includes('unit')
  );

  const priceColumnIndex = detectPriceColumn(headers);

  if (nameColumnIndex === -1) {
    throw new Error('Colonne "Nom" introuvable. Assurez-vous que votre CSV contient une colonne "Nom" ou "Ingrédient"');
  }

  if (priceColumnIndex === null) {
    throw new Error('Colonne "Prix" introuvable. Assurez-vous que votre CSV contient une colonne "Prix", "Coût au kg" ou similaire');
  }

  // Parse les lignes de données
  const ingredients = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // Skip lignes vides

    const cells = line.split(',').map((c) => c.trim());

    const name = cells[nameColumnIndex];
    const quantity = parseFloat(cells[quantityColumnIndex]) || 1;
    const unit = cells[unitColumnIndex] || 'kg';
    const price = parseFloat(cells[priceColumnIndex]);

    if (!name || isNaN(price)) {
      console.warn(`Ligne ignorée (données manquantes ou invalides): ${line}`);
      continue;
    }

    ingredients.push({
      id: `ingredient_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      name,
      quantity,
      unit,
      cost_per_unit: price,
      imported_at: new Date().toISOString(),
    });
  }

  return ingredients;
};

/**
 * Parse un fichier Excel (XLSX) - simplifié pour prototype
 * Attend une structure similaire au CSV
 * Note: Nécessite une lib comme "xlsx" pour vraie implémentation
 */
export const parseIngredientsExcel = (arrayBuffer) => {
  // Placeholder pour implémentation XLSX
  throw new Error('Le parsing XLSX nécessite la librairie "xlsx". Import CSV recommandé pour la production.');
};

/**
 * Valide un ingrédient importé
 */
export const validateIngredient = (ingredient) => {
  const errors = [];

  if (!ingredient.name || ingredient.name.trim().length === 0) {
    errors.push('Le nom de l\'ingrédient est obligatoire');
  }

  if (typeof ingredient.cost_per_unit !== 'number' || ingredient.cost_per_unit < 0) {
    errors.push('Le coût unitaire doit être un nombre positif');
  }

  if (ingredient.quantity <= 0) {
    errors.push('La quantité doit être supérieure à 0');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

export default {
  parseIngredientsCSV,
  parseIngredientsExcel,
  detectPriceColumn,
  validateIngredient,
};
