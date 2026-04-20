// ABOUTME: Extract Chronogolf course UUIDs from club landing pages for catalog expansion.
// ABOUTME: Parses the __NEXT_DATA__ JSON blob embedded in each club page to find club + course UUIDs.
const slugs = process.argv.slice(2);
if (slugs.length === 0) {
  console.error("Usage: node discover-chronogolf.mjs <slug1> [slug2] ...");
  process.exit(1);
}

const results = [];
for (const slug of slugs) {
  try {
    const res = await fetch(`https://www.chronogolf.com/club/${slug}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "text/html",
      },
    });
    if (!res.ok) {
      results.push({ slug, error: `HTTP ${res.status}` });
      continue;
    }
    const html = await res.text();
    const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
    if (!m) {
      results.push({ slug, error: "no __NEXT_DATA__ blob" });
      continue;
    }
    let data;
    try {
      data = JSON.parse(m[1]);
    } catch (e) {
      results.push({ slug, error: `JSON parse: ${e.message}` });
      continue;
    }
    const club = data?.props?.pageProps?.club;
    if (!club) {
      results.push({ slug, error: "no club in pageProps" });
      continue;
    }
    const courses = (club.courses || []).map((c) => ({
      id: c.id,
      name: c.name,
      holes: c.holes,
      bookableHoles: c.bookableHoles,
      uuid: c.uuid,
    }));
    // Chronogolf uses: address (street), city, province (US state name), postcode, location.{lat,lon}, country.
    const stateMap = {
      Minnesota: "MN",
      Wisconsin: "WI",
      "South Dakota": "SD",
      "North Dakota": "ND",
      Iowa: "IA",
      Illinois: "IL",
      California: "CA",
    };
    const stateAbbr = stateMap[club.province] || null;
    const fullAddress =
      club.address && club.city && club.province && club.postcode
        ? `${club.address}, ${club.city}, ${stateAbbr || club.province} ${club.postcode}`
        : null;
    results.push({
      slug,
      club: {
        uuid: club.uuid,
        id: club.id,
        active: club.active,
        name: club.name,
        streetAddress: club.address || null,
        city: club.city || null,
        province: club.province || null,
        stateAbbr,
        postcode: club.postcode || null,
        country: club.country || null,
        fullAddress,
        latitude: club.location?.lat ?? null,
        longitude: club.location?.lon ?? null,
        phone: club.phone || null,
        website: club.website || null,
      },
      courses,
    });
  } catch (e) {
    results.push({ slug, error: e.message });
  }
}

console.log(JSON.stringify(results, null, 2));
