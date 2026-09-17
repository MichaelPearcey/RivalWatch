-- Prices the owner typed in themselves. Needed where we cannot read them:
-- Instagram-only competitors, price lists published as images, offline quotes.
ALTER TABLE competitors ADD COLUMN pricing_notes TEXT;
