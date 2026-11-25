// La recherche de la citation dans la transcription vit dans src/shared/quote.ts (partagée avec l'API, qui
// s'en sert pour `from_marker`). Ré-exportée ici pour l'onglet Tickets.
export { findQuoteUtterance, normalizeText } from '../../shared/quote'
