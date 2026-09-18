// Relative pull strength per signal tier — adjacency is the user's own
// explicit data, so it's weighted well above anything inferred.
const TIER_STRENGTH = {
  adjacency: 1,
  color: 0.5,
  keyword: 0.3,
  fuzzy: 0.15,
}

// Canonical space-type nodes, each with the keywords/synonyms that map a
// room name onto it. Grouped by domain for readability — office/generic,
// transport, residential, plus two categories added after reading real
// project drawings (see below). Matching is substring-based against the
// lowercased room name, but resolved by LONGEST matching keyword across all
// nodes (see findKeywordCategory) rather than first-match-in-list-order —
// otherwise a specific compound term like "refuse store" would lose to the
// generic "store" keyword in a different node.
const TERM_NODES = {
  // Office / generic
  reception: ['reception', 'lobby', 'entrance', 'waiting', 'front desk', 'concierge', 'resident services'],
  circulation: ['corridor', 'circulation', 'atrium', 'stair', 'lift lobby', 'lift', 'elevator'],
  office: ['office', 'workspace', 'desk', 'open office', 'workstation'],
  meeting: ['meeting', 'conference', 'boardroom', 'huddle', 'conference room'],
  kitchen: ['kitchen', 'kitchenette', 'pantry', 'breakroom', 'break room', 'tea point', 'staff room', 'mess room', 'break out area'],
  wc: ['wc', 'toilet', 'restroom', 'washroom', 'bathroom', 'ablution', 'awc', 'family washroom'],
  plant: ['plant room', 'plant', 'mechanical', 'electrical', 'riser', 'switch room', 'boiler room'],
  server: ['server room', 'comms room', 'it room', 'data room', 'network room', 'main it', 'mdf', 'rmu', 'ups room', 'battery room', 'central battery'],
  storage: ['storage', 'store', 'archive', 'stock room', 'stationery'],
  print: ['print room', 'copy room', 'reprographics'],
  first_aid: ['first aid', 'medical', 'welfare room', 'sick bay'],
  cleaner: ['cleaner', "cleaner's room", 'janitor', 'housekeeping'],
  locker: ['locker room', 'changing room', 'cloakroom', 'staff shower'],
  loading: ['loading bay', 'goods in', 'delivery', 'dock', 'delivery shaft'],
  security: ['security', 'control room', 'cctv', 'security screening', 'security check', 'station security room'],

  // Transport (stations, airports, transport hubs)
  paid_concourse: ['paid concourse', 'paid circulation'],
  unpaid_concourse: ['unpaid concourse', 'concourse', 'hall', 'main hall'],
  fare_gates: ['afc cabinet', 'fare gates', 'ticket gates', 'turnstile'],
  boarding: ['platform', 'gate', 'boarding gate', 'pier'],
  ticketing: ['ticket office', 'ticket hall', 'box office', 'tvm', 'ticket vending machine', 'info desk'],
  check_in: ['check-in', 'check in desk', 'bag drop'],
  baggage: ['baggage claim', 'baggage reclaim', 'baggage handling', 'luggage'],
  customs_immigration: ['customs', 'immigration', 'border control', 'passport control'],
  retail: ['retail', 'shop', 'duty free', 'concession', 'kiosk', 'retail / f&b', 'food & beverage', 'retail provision'],
  dining: ['cafe', 'café', 'restaurant', 'food court', 'bar'],
  lounge: ['departure lounge', 'executive lounge', 'business lounge', 'airline lounge'],
  operations: ['control tower', 'operations room', 'dispatch', 'signal box', 'ops centre', 'dcc', 'fcc', 'bocc', 'civil defense', 'station control room'],
  parking: ['car park', 'parking', 'drop-off', 'pick-up', 'taxi rank'],

  // Residential
  dwelling: ['apartment', 'unit', 'flat', 'dwelling'],
  amenity: ['resident lounge', 'communal lounge', 'clubhouse', 'gym', 'co-working space', 'amenity space'],
  communal_garden: ['communal garden', 'courtyard', 'roof terrace', 'podium garden'],
  refuse: ['refuse store', 'bin store', 'waste store', 'recycling'],
  cycle_store: ['cycle store', 'bike store', 'bicycle storage'],
  post_room: ['post room', 'mail room', 'parcel store', 'package room'],
  laundry: ['laundry room', 'utility room'],

  // Added after reading ~90 real project drawings (metro stations, a
  // transport hub, and a rail depot) — see conversation history for the
  // extraction methodology and evidence (e.g. "DEPOT" recurred next to
  // "MEP" 356 times across the corpus; "PRAYER ROOM (F/M)" appeared
  // repeatedly on Gulf-region station levels).
  depot: ['depot', 'workshop', 'stabling', 'main workshop', 'wheel lathe', 'wash plant', 'blasting shop', 'rail systems'],
  prayer: ['prayer room', 'prayer', 'musalla'],
}

// Weighted edges between DIFFERENT nodes — positive = attract, negative =
// repel. No entry between a pair = no inferred relation at all. Kept
// deliberately small: every entry traces to a standard, textbook planning
// convention (hygiene separation, noise control, equipment protection,
// paid/unpaid fare-gate boundary, landside/airside separation) or was
// directly observed recurring in the real drawings referenced above — not
// a guess at requirements nobody stated.
const TERM_RELATIONS = [
  // Attract
  { a: 'reception', b: 'meeting', weight: 0.15 }, // client-facing meeting rooms near arrival
  { a: 'reception', b: 'security', weight: 0.15 }, // front-of-house security paired with reception
  { a: 'kitchen', b: 'office', weight: 0.15 }, // break facilities near where people work
  { a: 'print', b: 'office', weight: 0.15 }, // printing/copying near workspaces
  { a: 'loading', b: 'storage', weight: 0.15 }, // goods-in adjacent to what it's stocking
  { a: 'locker', b: 'wc', weight: 0.15 }, // changing facilities paired with washrooms
  { a: 'fare_gates', b: 'unpaid_concourse', weight: 0.2 }, // gate line sits on the unpaid boundary
  { a: 'fare_gates', b: 'paid_concourse', weight: 0.2 }, // ...and the paid boundary — the connector between both
  { a: 'ticketing', b: 'unpaid_concourse', weight: 0.15 }, // ticket office reachable before the gate line
  { a: 'retail', b: 'unpaid_concourse', weight: 0.15 }, // shops sit unpaid-side
  { a: 'dining', b: 'unpaid_concourse', weight: 0.15 }, // same logic as retail
  { a: 'boarding', b: 'paid_concourse', weight: 0.15 }, // platforms only reachable paid-side
  { a: 'lounge', b: 'boarding', weight: 0.15 }, // lounges near gate areas pre-departure
  { a: 'parking', b: 'unpaid_concourse', weight: 0.15 }, // landside drop-off to the main hall
  { a: 'operations', b: 'boarding', weight: 0.1 }, // control functions need sightlines to platforms/gates
  { a: 'check_in', b: 'baggage', weight: 0.2 }, // check-in desks adjacent to bag drop/handling
  { a: 'customs_immigration', b: 'baggage', weight: 0.15 }, // arrivals flow: reclaim near border control
  { a: 'reception', b: 'amenity', weight: 0.15 }, // concierge near shared amenity for oversight
  { a: 'refuse', b: 'loading', weight: 0.15 }, // bin stores near service access for collection
  { a: 'cycle_store', b: 'reception', weight: 0.15 }, // cycle storage near entrance for security/oversight
  { a: 'post_room', b: 'reception', weight: 0.15 }, // mail/parcel handling near the front desk
  { a: 'laundry', b: 'amenity', weight: 0.15 }, // shared laundry grouped with other communal facilities
  { a: 'amenity', b: 'communal_garden', weight: 0.15 }, // indoor amenity connected to outdoor amenity
  { a: 'prayer', b: 'wc', weight: 0.2 }, // prayer facilities consistently paired with ablution/washroom space
  { a: 'depot', b: 'plant', weight: 0.15 }, // depot buildings are consistently MEP-dense (evidence: DEPOT↔MEP, 356x)

  // Repel
  { a: 'wc', b: 'kitchen', weight: -0.2 }, // hygiene separation — food/water regs convention
  { a: 'server', b: 'wc', weight: -0.2 }, // moisture/flood risk to IT equipment
  { a: 'plant', b: 'meeting', weight: -0.15 }, // noise/vibration away from quiet spaces
  { a: 'plant', b: 'office', weight: -0.15 }, // same, general workspace
  { a: 'loading', b: 'reception', weight: -0.15 }, // service/goods access kept separate from public entrance
  { a: 'customs_immigration', b: 'retail', weight: -0.2 }, // sealed/restricted zone kept apart from open retail
  { a: 'operations', b: 'retail', weight: -0.15 }, // operational spaces kept away from public commercial areas
  { a: 'plant', b: 'unpaid_concourse', weight: -0.15 }, // services/noise kept off the primary public space
  { a: 'loading', b: 'unpaid_concourse', weight: -0.15 }, // goods/service access separated from passenger flow
  { a: 'refuse', b: 'amenity', weight: -0.2 }, // odour/hygiene, kept away from communal lounge space
  { a: 'refuse', b: 'reception', weight: -0.15 }, // kept away from the main arrival experience
  { a: 'plant', b: 'dwelling', weight: -0.2 }, // noise/vibration kept away from actual living units
]

const relationsByPair = new Map(TERM_RELATIONS.map((r) => [[r.a, r.b].sort().join('|'), r.weight]))

const FUZZY_SIMILARITY_THRESHOLD = 0.5

// Longest matching keyword wins across ALL nodes, not first-match-in-list
// order — otherwise a specific compound term like "refuse store" (the
// `refuse` node) would lose to the generic "store" keyword (the `storage`
// node) whenever a room happened to be named something containing both.
function findKeywordCategory(roomName) {
  const lower = roomName.toLowerCase()
  let bestCategory = null
  let bestLength = 0
  Object.entries(TERM_NODES).forEach(([category, keywords]) => {
    keywords.forEach((keyword) => {
      if (keyword.length > bestLength && lower.includes(keyword)) {
        bestCategory = category
        bestLength = keyword.length
      }
    })
  })
  return bestCategory
}

function tokenize(roomName) {
  return new Set(
    roomName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 0 && Number.isNaN(Number(word))),
  )
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0
  let intersection = 0
  setA.forEach((word) => {
    if (setB.has(word)) intersection += 1
  })
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

// One affinity entry per unordered room pair with a non-zero pull, picking
// the single highest-priority signal that applies rather than summing tiers
// — that's what makes this a hierarchy (an explicit adjacency rule always
// wins) instead of several weak guesses drowning it out. `maxDistancePx` is
// only set for the adjacency tier — it's a ceiling from the user's own data,
// not a target distance, so the physics force treats it as a threshold
// spring (only pulls once exceeded) rather than pulling to an exact length.
//
// The keyword tier now has two forms: same-node (both rooms map to the same
// space type — a flat attraction, as before) and cross-node (the two rooms
// map to DIFFERENT nodes that have a TERM_RELATIONS edge between them —
// strength can be positive (attract) or negative (repel) here, unlike every
// other tier).
export function computeAffinities(roomBoxes, scale) {
  const affinities = []
  const tokensById = new Map(roomBoxes.map((box) => [box.id, tokenize(box.roomName || '')]))
  const categoryById = new Map(roomBoxes.map((box) => [box.id, findKeywordCategory(box.roomName || '')]))

  for (let i = 0; i < roomBoxes.length; i += 1) {
    for (let j = i + 1; j < roomBoxes.length; j += 1) {
      const a = roomBoxes[i]
      const b = roomBoxes[j]

      // Adjacency is keyed by room name (not id) in the data model, and only
      // needs to be declared from one side of the pair.
      const maxDistanceMeters = a.adjacentRooms?.[b.roomName] ?? b.adjacentRooms?.[a.roomName]
      if (Number.isFinite(maxDistanceMeters)) {
        affinities.push({
          aId: a.id,
          bId: b.id,
          tier: 'adjacency',
          strength: TIER_STRENGTH.adjacency,
          maxDistancePx: maxDistanceMeters * scale,
        })
        continue
      }

      if (a.color && b.color && a.color === b.color) {
        affinities.push({ aId: a.id, bId: b.id, tier: 'color', strength: TIER_STRENGTH.color })
        continue
      }

      const categoryA = categoryById.get(a.id)
      const categoryB = categoryById.get(b.id)
      if (categoryA && categoryB) {
        if (categoryA === categoryB) {
          affinities.push({ aId: a.id, bId: b.id, tier: 'keyword', strength: TIER_STRENGTH.keyword })
          continue
        }
        const relationWeight = relationsByPair.get([categoryA, categoryB].sort().join('|'))
        if (relationWeight !== undefined) {
          affinities.push({ aId: a.id, bId: b.id, tier: 'keyword', strength: relationWeight })
          continue
        }
      }

      const similarity = jaccardSimilarity(tokensById.get(a.id), tokensById.get(b.id))
      if (similarity >= FUZZY_SIMILARITY_THRESHOLD) {
        affinities.push({ aId: a.id, bId: b.id, tier: 'fuzzy', strength: TIER_STRENGTH.fuzzy * similarity })
      }
    }
  }

  return affinities
}
