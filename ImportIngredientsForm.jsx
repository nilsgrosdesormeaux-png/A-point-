import React, { useState, useRef } from 'react';
import { parseIngredientsCSV, validateIngredient } from './csvParser.utils';
import './ImportIngredientsForm.css';

/**
 * Composant d'import des fiches techniques (ingrédients avec prix)
 * Parse CSV, détecte colonne "prix" automatiquement, stocke dans le state global
 */

const ImportIngredientsForm = ({ onIngredientsImported, existingIngredients = [] }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [importStatus, setImportStatus] = useState('idle'); // idle | loading | success | error
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [importedCount, setImportedCount] = useState(0);
  const fileInputRef = useRef(null);

  const handleFileSelect = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportStatus('loading');
    setErrorMessage('');
    setSuccessMessage('');

    try {
      // Lit le fichier comme texte
      const text = await file.text();

      // Parse le CSV
      const ingredients = parseIngredientsCSV(text);

      // Valide chaque ingrédient
      const validatedIngredients = [];
      let validCount = 0;
      let skipCount = 0;

      ingredients.forEach((ingredient) => {
        const validation = validateIngredient(ingredient);
        if (validation.isValid) {
          validatedIngredients.push(ingredient);
          validCount++;
        } else {
          console.warn(
            `Ingrédient "${ingredient.name}" rejeté:`,
            validation.errors.join(', ')
          );
          skipCount++;
        }
      });

      if (validatedIngredients.length === 0) {
        throw new Error('Aucun ingrédient valide n\'a pu être importé. Vérifiez le format de votre CSV.');
      }

      // Appel la callback avec les ingrédients validés
      onIngredientsImported(validatedIngredients);

      setImportedCount(validCount);
      setSuccessMessage(
        `✅ ${validCount} ingrédient(s) importé(s) avec succès${
          skipCount > 0 ? ` (${skipCount} rejeté(s))` : ''
        }.`
      );
      setImportStatus('success');

      // Réinitialise le champ fichier
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      // Ferme le dialog après 2 secondes
      setTimeout(() => {
        setIsOpen(false);
        setImportStatus('idle');
      }, 2000);
    } catch (error) {
      setErrorMessage(error.message || 'Une erreur est survenue lors de l\'import.');
      setImportStatus('error');
    }
  };

  return (
    <div className="import-ingredients-form">
      {/* Bouton pour ouvrir le dialog */}
      <button className="btn-import-open" onClick={() => setIsOpen(true)}>
        📥 Importer les coûts des ingrédients
      </button>

      {/* Affiche le nombre d'ingrédients importés */}
      {existingIngredients.length > 0 && (
        <p className="import-status-text">
          ✓ {existingIngredients.length} ingrédient(s) en base (coûts détectés)
        </p>
      )}

      {/* Dialog d'import */}
      {isOpen && (
        <div className="modal-overlay" onClick={() => setIsOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Importer les coûts des ingrédients</h2>
              <button className="btn-close" onClick={() => setIsOpen(false)}>
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="import-instructions">
                <h3>📋 Format du CSV attendu</h3>
                <p>
                  Votre fichier CSV doit contenir les colonnes suivantes (l'ordre n'a pas d'importance) :
                </p>
                <ul>
                  <li><strong>Nom</strong> ou <strong>Ingrédient</strong> — Le nom de l'ingrédient</li>
                  <li><strong>Prix</strong>, <strong>Coût au kg</strong>, ou <strong>Coût unitaire</strong> — Le prix/coût (obligatoire)</li>
                  <li><strong>Quantité</strong> (optionnel) — Quantité par défaut</li>
                  <li><strong>Unité</strong> (optionnel) — kg, L, pièce, etc.</li>
                </ul>

                <p className="example-text">
                  💡 <strong>Exemple :</strong> <code>Nom,Coût au kg,Quantité,Unité</code>
                </p>
                <p className="example-text">
                  <code>Farine T55,0.45,50,kg</code><br/>
                  <code>Beurre demi-sel,7.20,5,kg</code><br/>
                  <code>Œufs fermiers,0.35,12,pièce</code>
                </p>
              </div>

              {/* Zone de drop/upload */}
              <div className="file-upload-zone">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileSelect}
                  disabled={importStatus === 'loading'}
                  className="file-input"
                />
                <label className="file-label">
                  <span className="file-icon">📤</span>
                  <span className="file-text">
                    {importStatus === 'loading' ? (
                      'Traitement en cours...'
                    ) : (
                      <>
                        Glissez-déposez votre CSV ici<br/>
                        <small>ou cliquez pour sélectionner</small>
                      </>
                    )}
                  </span>
                </label>
              </div>

              {/* Messages de statut */}
              {importStatus === 'success' && (
                <div className="status-message status-success">
                  {successMessage}
                </div>
              )}

              {importStatus === 'error' && (
                <div className="status-message status-error">
                  ⚠️ {errorMessage}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn-close-modal" onClick={() => setIsOpen(false)}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImportIngredientsForm;
