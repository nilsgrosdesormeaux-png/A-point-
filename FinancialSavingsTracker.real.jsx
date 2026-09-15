import React, { useEffect, useState } from 'react';
import { calculateAvoidedWaste, hasSufficientData } from './costCalculation.utils';
import './FinancialSavingsTracker.real.css';

/**
 * Composant Financial Savings Tracker RÉEL
 * Affiche les économies basées sur des données importées
 *
 * Props :
 * - ingredientsList: Array d'ingrédients avec { id, name, cost_per_unit, ... }
 * - productsList: Array de produits avec { id, name, recipe: [{ingredientId, quantityUsed}, ...] }
 * - forecastData: { productId: quantityForecast, ... }
 * - historicalData: { productId: [qty1, qty2, qty3, ...], ... }
 * - productCosts: { productId: costOfProduction, ... }
 */

const FinancialSavingsTracker = ({
  ingredientsList = [],
  productsList = [],
  forecastData = {},
  historicalData = {},
  productCosts = {},
  currency = '€',
}) => {
  const [displayedSavings, setDisplayedSavings] = useState(0);
  const [savingsData, setSavingsData] = useState(null);
  const [isAnimating, setIsAnimating] = useState(false);

  // Vérifie si les données suffisent et calcule les économies
  useEffect(() => {
    const enoughData = hasSufficientData(
      ingredientsList,
      productsList,
      forecastData,
      historicalData
    );

    if (!enoughData) {
      setSavingsData(null);
      setDisplayedSavings(0);
      return;
    }

    // Calcule les économies réelles
    const result = calculateAvoidedWaste(forecastData, historicalData, productCosts);
    setSavingsData(result);

    // Animation du nombre
    setIsAnimating(true);
    let current = 0;
    const target = result.totalSavings;
    const step = target / 50; // 50 étapes

    const interval = setInterval(() => {
      current += step;
      if (current >= target) {
        setDisplayedSavings(target);
        clearInterval(interval);
        setIsAnimating(false);
      } else {
        setDisplayedSavings(Math.round(current * 100) / 100);
      }
    }, 30);

    return () => clearInterval(interval);
  }, [ingredientsList, productsList, forecastData, historicalData, productCosts]);

  // État 1 : Pas de données importées
  if (ingredientsList.length === 0) {
    return (
      <div className="financial-savings-tracker">
        <div className="savings-card savings-card--empty">
          <div className="empty-state">
            <div className="empty-icon">📥</div>
            <h3>Importez vos coûts d'ingrédients</h3>
            <p>
              Les économies réalisées s'afficheront ici une fois que vous aurez importé le coût
              de vos ingrédients.
            </p>
            <p className="empty-hint">
              Utilisez le bouton "Importer les coûts des ingrédients" pour commencer.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // État 2 : Pas assez de données (historique manquant, etc.)
  if (!savingsData || !savingsData.hasData) {
    return (
      <div className="financial-savings-tracker">
        <div className="savings-card savings-card--empty">
          <div className="empty-state">
            <div className="empty-icon">📊</div>
            <h3>Données historiques manquantes</h3>
            <p>
              Pour calculer les économies, nous avons besoin d'un historique de vos ventes
              (au moins 2 semaines de données).
            </p>
            <p className="empty-hint">
              Les économies s'afficheront automatiquement une fois que vous aurez suffisamment
              de données.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // État 3 : Données complètes - Affiche les économies réelles
  return (
    <div className="financial-savings-tracker">
      <div className="savings-card">
        <div className="savings-header">
          <h3 className="savings-title">💰 Économies réalisées</h3>
          <p className="savings-subtitle">Gaspillage évité grâce à vos prévisions précises</p>
        </div>

        {/* Métrique principale */}
        <div className="savings-metric">
          <div className="savings-amount">
            <span className="amount-value">
              ≈ {displayedSavings.toFixed(2)}
            </span>
            <span className="amount-currency">{currency}</span>
          </div>
          <p className="savings-metric-text">sauvés de la poubelle cette semaine</p>
        </div>

        {/* Détail : Nombre de produits évités */}
        {savingsData.breakdown.length > 0 && (
          <div className="savings-impact">
            <p className="impact-text">
              📈 <strong>{savingsData.breakdown.length}</strong> produit(s) produit(s) en moins
              grâce à vos prévisions — zéro gaspillage ajouté.
            </p>
          </div>
        )}

        {/* Breakdown détaillé (optionnel - masqué par défaut pour clarté) */}
        <details className="savings-breakdown-detail">
          <summary className="breakdown-summary">
            📋 Voir le détail par produit
          </summary>
          <div className="breakdown-items">
            {savingsData.breakdown.map((item, index) => (
              <div key={index} className="breakdown-item">
                <div className="breakdown-row">
                  <span className="breakdown-label">Produit ID:</span>
                  <span className="breakdown-value">{item.productId}</span>
                </div>
                <div className="breakdown-row">
                  <span className="breakdown-label">Moyenne habituelle:</span>
                  <span className="breakdown-value">{item.habitualAvg} unités</span>
                </div>
                <div className="breakdown-row">
                  <span className="breakdown-label">Prévision À Point:</span>
                  <span className="breakdown-value">{item.forecast} unités</span>
                </div>
                <div className="breakdown-row">
                  <span className="breakdown-label">Gaspillage évité:</span>
                  <span className="breakdown-value breakdown-value--saved">
                    {item.wasteAvoided} unités
                  </span>
                </div>
                <div className="breakdown-row breakdown-row--total">
                  <span className="breakdown-label">Économie:</span>
                  <span className="breakdown-value breakdown-value--savings">
                    {item.savingsAmount.toFixed(2)}{currency}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </details>

        {/* CTA */}
        <div className="savings-cta">
          <p className="cta-text">
            💡 Continuez à affiner vos prévisions pour maximiser les économies et réduire le gaspillage.
          </p>
        </div>
      </div>
    </div>
  );
};

export default FinancialSavingsTracker;
