-- Instagram profiles are read through Meta's Business Discovery API, not by
-- fetching instagram.com (robots.txt forbids it). Move existing links over.
UPDATE monitored_pages SET source_type = 'instagram'
WHERE source_type = 'website'
  AND (url LIKE 'http://instagram.com/%' OR url LIKE 'https://instagram.com/%'
    OR url LIKE 'http://www.instagram.com/%' OR url LIKE 'https://www.instagram.com/%');
