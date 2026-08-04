/* Open World Maps — realm data
   ------------------------------------------------------------------
   CITIES: the default points of interest. Add or remove freely.
   STATES: rough extents (south, west, north, east) used to decide how
           much of a state a discovery clears. Each discovered city
           claims the part of its state nearer to it than to any other
           city in that state.

   Upgrading to true state outlines: define window.OW_STATE_SHAPES as
   { AL: [[[lng,lat],...]], ... } (GeoJSON-style rings) and the region
   builder will clip to the polygon instead of the box.
   ------------------------------------------------------------------ */
window.OW_DATA = {

STATES: {
  AL:{name:'Alabama',        bbox:[30.14,-88.48,35.01,-84.89]},
  AK:{name:'Alaska',         bbox:[54.50,-169.90,71.50,-129.90]},
  AZ:{name:'Arizona',        bbox:[31.33,-114.82,37.00,-109.05]},
  AR:{name:'Arkansas',       bbox:[33.00,-94.62,36.50,-89.64]},
  CA:{name:'California',     bbox:[32.53,-124.41,42.01,-114.13]},
  CO:{name:'Colorado',       bbox:[36.99,-109.06,41.00,-102.04]},
  CT:{name:'Connecticut',    bbox:[40.98,-73.73,42.05,-71.79]},
  DE:{name:'Delaware',       bbox:[38.45,-75.79,39.84,-75.05]},
  FL:{name:'Florida',        bbox:[24.52,-87.63,31.00,-80.03]},
  GA:{name:'Georgia',        bbox:[30.36,-85.61,35.00,-80.84]},
  HI:{name:'Hawaii',         bbox:[18.91,-160.25,22.24,-154.81]},
  ID:{name:'Idaho',          bbox:[41.99,-117.24,49.00,-111.04]},
  IL:{name:'Illinois',       bbox:[36.97,-91.51,42.51,-87.02]},
  IN:{name:'Indiana',        bbox:[37.77,-88.10,41.76,-84.78]},
  IA:{name:'Iowa',           bbox:[40.38,-96.64,43.50,-90.14]},
  KS:{name:'Kansas',         bbox:[36.99,-102.05,40.00,-94.59]},
  KY:{name:'Kentucky',       bbox:[36.50,-89.57,39.15,-81.96]},
  LA:{name:'Louisiana',      bbox:[28.93,-94.04,33.02,-88.76]},
  ME:{name:'Maine',          bbox:[42.98,-71.08,47.46,-66.95]},
  MD:{name:'Maryland',       bbox:[37.91,-79.49,39.72,-75.05]},
  MA:{name:'Massachusetts',  bbox:[41.24,-73.51,42.89,-69.93]},
  MI:{name:'Michigan',       bbox:[41.70,-90.42,48.30,-82.12]},
  MN:{name:'Minnesota',      bbox:[43.50,-97.24,49.38,-89.49]},
  MS:{name:'Mississippi',    bbox:[30.17,-91.65,35.00,-88.10]},
  MO:{name:'Missouri',       bbox:[35.99,-95.77,40.61,-89.10]},
  MT:{name:'Montana',        bbox:[44.36,-116.05,49.00,-104.04]},
  NE:{name:'Nebraska',       bbox:[39.99,-104.05,43.00,-95.31]},
  NV:{name:'Nevada',         bbox:[35.00,-120.01,42.00,-114.04]},
  NH:{name:'New Hampshire',  bbox:[42.70,-72.56,45.31,-70.70]},
  NJ:{name:'New Jersey',     bbox:[38.93,-75.56,41.36,-73.89]},
  NM:{name:'New Mexico',     bbox:[31.33,-109.05,37.00,-103.00]},
  NY:{name:'New York',       bbox:[40.50,-79.76,45.02,-71.86]},
  NC:{name:'North Carolina', bbox:[33.84,-84.32,36.59,-75.46]},
  ND:{name:'North Dakota',   bbox:[45.94,-104.05,49.00,-96.55]},
  OH:{name:'Ohio',           bbox:[38.40,-84.82,41.98,-80.52]},
  OK:{name:'Oklahoma',       bbox:[33.62,-103.00,37.00,-94.43]},
  OR:{name:'Oregon',         bbox:[41.99,-124.57,46.29,-116.46]},
  PA:{name:'Pennsylvania',   bbox:[39.72,-80.52,42.27,-74.69]},
  RI:{name:'Rhode Island',   bbox:[41.15,-71.86,42.02,-71.12]},
  SC:{name:'South Carolina', bbox:[32.03,-83.35,35.22,-78.54]},
  SD:{name:'South Dakota',   bbox:[42.48,-104.06,45.95,-96.44]},
  TN:{name:'Tennessee',      bbox:[34.98,-90.31,36.68,-81.65]},
  TX:{name:'Texas',          bbox:[25.84,-106.65,36.50,-93.51]},
  UT:{name:'Utah',           bbox:[36.99,-114.05,42.00,-109.04]},
  VT:{name:'Vermont',        bbox:[42.73,-73.44,45.02,-71.47]},
  VA:{name:'Virginia',       bbox:[36.54,-83.68,39.47,-75.24]},
  WA:{name:'Washington',     bbox:[45.54,-124.85,49.00,-116.92]},
  WV:{name:'West Virginia',  bbox:[37.20,-82.64,40.64,-77.72]},
  WI:{name:'Wisconsin',      bbox:[42.49,-92.89,47.31,-86.25]},
  WY:{name:'Wyoming',        bbox:[40.99,-111.06,45.01,-104.05]}
},

/* ── The bounds of the realms ───────────────────────────────────────
   Coarse outline of US land, as [lng,lat] rings. Fog is clipped to
   these shapes, so the oceans, Canada and Mexico are always visible.
   Swap in a finer coastline any time — nothing else needs to change. */
OUTLINE: [
  [ /* the contiguous realms */
    [-124.7,48.4],[-124.1,46.9],[-124.0,45.5],[-124.1,43.8],[-124.4,42.8],
    [-124.2,41.0],[-123.8,39.8],[-122.9,38.9],[-122.5,37.8],[-121.9,36.9],
    [-120.6,35.1],[-119.5,34.4],[-118.4,33.7],[-117.1,32.5],[-114.7,32.7],
    [-114.8,31.9],[-111.0,31.3],[-108.2,31.3],[-108.2,31.8],[-106.5,31.8],
    [-105.0,30.6],[-103.1,29.0],[-102.4,29.8],[-101.4,29.8],[-99.5,27.5],
    [-97.2,25.9],[-97.4,27.0],[-96.4,28.4],[-95.0,29.1],[-93.8,29.7],
    [-92.0,29.6],[-90.2,29.1],[-89.0,29.2],[-88.9,30.4],[-87.5,30.3],
    [-86.0,30.4],[-84.3,30.0],[-83.6,29.9],[-82.9,29.0],[-82.7,27.9],
    [-82.0,26.5],[-81.1,25.2],[-80.4,25.2],[-80.1,26.7],[-80.6,28.5],
    [-81.2,29.8],[-80.9,32.0],[-79.2,33.2],[-77.9,34.0],[-75.8,35.2],
    [-75.5,36.6],[-76.0,37.2],[-75.1,38.0],[-74.4,39.3],[-73.9,40.5],
    [-72.0,41.0],[-70.0,41.6],[-70.7,42.7],[-70.0,43.6],[-69.0,44.0],
    [-67.0,44.8],[-67.8,45.7],[-69.2,47.5],[-70.3,46.0],[-71.5,45.0],
    [-74.7,45.0],[-76.9,44.0],[-79.0,43.3],[-82.5,41.7],[-83.1,42.3],
    [-82.4,45.0],[-84.0,46.5],[-84.6,46.5],[-88.0,48.2],[-89.5,48.0],
    [-95.2,49.0],[-104.0,49.0],[-116.0,49.0],[-123.0,49.0]
  ],
  [ /* the frozen northern wilds */
    [-141.0,70.0],[-141.0,60.0],[-139.0,60.0],[-135.0,58.5],[-130.0,55.0],
    [-133.0,55.6],[-138.0,58.6],[-148.0,59.5],[-153.0,57.0],[-158.0,55.2],
    [-163.0,54.6],[-166.0,60.0],[-162.0,63.0],[-166.0,66.0],[-161.0,68.5],
    [-156.0,71.4]
  ],
  [ /* the isle chain of fire */
    [-160.3,22.3],[-154.7,22.3],[-154.7,18.8],[-160.3,18.8]
  ]
],

/* ── Marginalia ────────────────────────────────────────────────────
   Creatures and lettering drawn beyond the fog. kind must match a
   glyph in app.js; size is roughly the height in pixels. */
LORE: [
  { kind:'hydra',   lat: 37.5, lng:-133.5, size:96 },
  { kind:'kraken',  lat: 29.0, lng:-129.0, size:88 },
  { kind:'ship',    lat: 45.5, lng:-133.0, size:62 },
  { kind:'whale',   lat: 50.5, lng:-137.0, size:66 },
  { kind:'serpent', lat: 24.0, lng:-124.0, size:92 },
  { kind:'kraken',  lat: 33.5, lng: -67.0, size:88 },
  { kind:'ship',    lat: 40.5, lng: -62.5, size:62 },
  { kind:'serpent', lat: 27.5, lng: -71.5, size:92 },
  { kind:'whale',   lat: 44.5, lng: -57.5, size:66 },
  { kind:'compass', lat: 21.5, lng: -62.0, size:104 },
  { kind:'serpent', lat: 24.5, lng: -90.0, size:80 },
  { kind:'ship',    lat: 21.5, lng: -94.5, size:58 },
  { kind:'yeti',    lat: 53.0, lng:-104.0, size:74 },
  { kind:'yeti',    lat: 56.5, lng: -88.0, size:70 },
  { kind:'pines',   lat: 51.5, lng:-118.0, size:56 },
  { kind:'peaks',   lat: 54.5, lng:-122.0, size:58 },
  { kind:'pines',   lat: 49.5, lng: -78.0, size:56 },
  { kind:'dragon',  lat: 57.0, lng:-131.0, size:86 },
  { kind:'volcano', lat: 19.5, lng:-102.5, size:66 },
  { kind:'dragon',  lat: 25.5, lng:-107.5, size:86 },
  { kind:'castle',  lat: 19.8, lng: -99.2, size:52 },
  { kind:'peaks',   lat: 62.5, lng:-112.0, size:58 },
  { kind:'volcano', lat: 19.4, lng:-155.3, size:54 }
],

LABELS: [
  { text:'The Whispering Sea',      lat: 39.0, lng:-138.0, rot:-90, size:15 },
  { text:'The Great Eastern Deep',  lat: 34.0, lng: -60.5, rot: -68, size:15 },
  { text:'The Sunken Gulf',         lat: 25.6, lng: -87.5, rot:  0, size:13 },
  { text:'Kingdoms of the Frozen North', lat: 58.5, lng:-100.0, rot:0, size:14 },
  { text:'The Sunward Realms',      lat: 22.5, lng:-103.5, rot: 12, size:13 },
  { text:'Here be Wanderers',       lat: 30.5, lng:-137.5, rot:-90, size:11 }
],

CITIES: [
  {n:'Gulf Shores',        s:'AL', lat:30.2460, lng:-87.7008},
  {n:'Birmingham',         s:'AL', lat:33.5186, lng:-86.8104},
  {n:'Huntsville',         s:'AL', lat:34.7304, lng:-86.5861},

  {n:'Anchorage',          s:'AK', lat:61.2181, lng:-149.9003},
  {n:'Juneau',             s:'AK', lat:58.3019, lng:-134.4197},
  {n:'Ketchikan',          s:'AK', lat:55.3422, lng:-131.6461},

  {n:'Phoenix',            s:'AZ', lat:33.4484, lng:-112.0740},
  {n:'Tucson',             s:'AZ', lat:32.2226, lng:-110.9747},
  {n:'Flagstaff',          s:'AZ', lat:35.1983, lng:-111.6513},

  {n:'Hot Springs',        s:'AR', lat:34.5037, lng:-93.0552},
  {n:'Bentonville',        s:'AR', lat:36.3729, lng:-94.2088},
  {n:'Eureka Springs',     s:'AR', lat:36.4015, lng:-93.7377},

  {n:'Los Angeles',        s:'CA', lat:34.0522, lng:-118.2437},
  {n:'San Francisco',      s:'CA', lat:37.7749, lng:-122.4194},
  {n:'San Diego',          s:'CA', lat:32.7157, lng:-117.1611},

  {n:'Denver',             s:'CO', lat:39.7392, lng:-104.9903},
  {n:'Colorado Springs',   s:'CO', lat:38.8339, lng:-104.8214},
  {n:'Aspen',              s:'CO', lat:39.1911, lng:-106.8175},

  {n:'Mystic',             s:'CT', lat:41.3543, lng:-71.9665},
  {n:'New Haven',          s:'CT', lat:41.3083, lng:-72.9279},
  {n:'Hartford',           s:'CT', lat:41.7658, lng:-72.6734},

  {n:'Rehoboth Beach',     s:'DE', lat:38.7209, lng:-75.0760},
  {n:'Wilmington',         s:'DE', lat:39.7459, lng:-75.5466},

  {n:'Orlando',            s:'FL', lat:28.5383, lng:-81.3792},
  {n:'Miami',              s:'FL', lat:25.7617, lng:-80.1918},
  {n:'Key West',           s:'FL', lat:24.5551, lng:-81.7800},

  {n:'Atlanta',            s:'GA', lat:33.7490, lng:-84.3880},
  {n:'Savannah',           s:'GA', lat:32.0809, lng:-81.0912},

  {n:'Honolulu',           s:'HI', lat:21.3069, lng:-157.8583},
  {n:'Lahaina',            s:'HI', lat:20.8783, lng:-156.6825},
  {n:'Kailua-Kona',        s:'HI', lat:19.6400, lng:-155.9969},

  {n:'Boise',              s:'ID', lat:43.6150, lng:-116.2023},
  {n:"Coeur d'Alene",      s:'ID', lat:47.6777, lng:-116.7805},
  {n:'Sun Valley',         s:'ID', lat:43.6968, lng:-114.3517},

  {n:'Chicago',            s:'IL', lat:41.8781, lng:-87.6298},
  {n:'Manteno',            s:'IL', lat:41.2497, lng:-87.8367},

  {n:'Indianapolis',       s:'IN', lat:39.7684, lng:-86.1581},
  {n:'Bloomington',        s:'IN', lat:39.1653, lng:-86.5264},

  {n:'Des Moines',         s:'IA', lat:41.5868, lng:-93.6250},
  {n:'Dubuque',            s:'IA', lat:42.5006, lng:-90.6646},

  {n:'Wichita',            s:'KS', lat:37.6872, lng:-97.3301},
  {n:'Lawrence',           s:'KS', lat:38.9717, lng:-95.2353},

  {n:'Louisville',         s:'KY', lat:38.2527, lng:-85.7585},
  {n:'Lexington',          s:'KY', lat:38.0406, lng:-84.5037},
  {n:'Bardstown',          s:'KY', lat:37.8092, lng:-85.4669},

  {n:'New Orleans',        s:'LA', lat:29.9511, lng:-90.0715},
  {n:'Baton Rouge',        s:'LA', lat:30.4515, lng:-91.1871},

  {n:'Bar Harbor',         s:'ME', lat:44.3876, lng:-68.2039},
  {n:'Portland',           s:'ME', lat:43.6591, lng:-70.2568},
  {n:'Ogunquit',           s:'ME', lat:43.2492, lng:-70.5990},

  {n:'Ocean City',         s:'MD', lat:38.3365, lng:-75.0849},
  {n:'Baltimore',          s:'MD', lat:39.2904, lng:-76.6122},
  {n:'Annapolis',          s:'MD', lat:38.9784, lng:-76.4922},

  {n:'Boston',             s:'MA', lat:42.3601, lng:-71.0589},
  {n:'Salem',              s:'MA', lat:42.5195, lng:-70.8967},
  {n:'Provincetown',       s:'MA', lat:42.0584, lng:-70.1787},

  {n:'Detroit',            s:'MI', lat:42.3314, lng:-83.0458},
  {n:'Mackinac Island',    s:'MI', lat:45.8492, lng:-84.6189},
  {n:'Traverse City',      s:'MI', lat:44.7631, lng:-85.6206},

  {n:'Minneapolis',        s:'MN', lat:44.9778, lng:-93.2650},
  {n:'Duluth',             s:'MN', lat:46.7867, lng:-92.1005},

  {n:'Biloxi',             s:'MS', lat:30.3960, lng:-88.8853},
  {n:'Natchez',            s:'MS', lat:31.5604, lng:-91.4032},

  {n:'St. Louis',          s:'MO', lat:38.6270, lng:-90.1994},
  {n:'Branson',            s:'MO', lat:36.6437, lng:-93.2185},
  {n:'Kansas City',        s:'MO', lat:39.0997, lng:-94.5786},

  {n:'Bozeman',            s:'MT', lat:45.6770, lng:-111.0429},
  {n:'Whitefish',          s:'MT', lat:48.4111, lng:-114.3376},

  {n:'Omaha',              s:'NE', lat:41.2565, lng:-95.9345},
  {n:'Lincoln',            s:'NE', lat:40.8136, lng:-96.7026},

  {n:'Las Vegas',          s:'NV', lat:36.1699, lng:-115.1398},
  {n:'Reno',               s:'NV', lat:39.5296, lng:-119.8138},

  {n:'North Conway',       s:'NH', lat:44.0537, lng:-71.1284},
  {n:'Portsmouth',         s:'NH', lat:43.0718, lng:-70.7626},

  {n:'Atlantic City',      s:'NJ', lat:39.3643, lng:-74.4229},
  {n:'Cape May',           s:'NJ', lat:38.9351, lng:-74.9060},
  {n:'Asbury Park',        s:'NJ', lat:40.2204, lng:-74.0121},

  {n:'Albuquerque',        s:'NM', lat:35.0844, lng:-106.6504},
  {n:'Santa Fe',           s:'NM', lat:35.6870, lng:-105.9378},
  {n:'Taos',               s:'NM', lat:36.4072, lng:-105.5731},

  {n:'New York City',      s:'NY', lat:40.7128, lng:-74.0060},
  {n:'Niagara Falls',      s:'NY', lat:43.0962, lng:-79.0377},

  {n:'Charlotte',          s:'NC', lat:35.2271, lng:-80.8431},
  {n:'Tryon',              s:'NC', lat:35.2098, lng:-82.2382},
  {n:'Asheville',          s:'NC', lat:35.5951, lng:-82.5515},

  {n:'Fargo',              s:'ND', lat:46.8772, lng:-96.7898},
  {n:'Medora',             s:'ND', lat:46.9139, lng:-103.5238},

  {n:'Cleveland',          s:'OH', lat:41.4993, lng:-81.6944},
  {n:'Cincinnati',         s:'OH', lat:39.1031, lng:-84.5120},
  {n:'Columbus',           s:'OH', lat:39.9612, lng:-82.9988},

  {n:'Oklahoma City',      s:'OK', lat:35.4676, lng:-97.5164},
  {n:'Tulsa',              s:'OK', lat:36.1540, lng:-95.9928},

  {n:'Portland',           s:'OR', lat:45.5152, lng:-122.6784},
  {n:'Bend',               s:'OR', lat:44.0582, lng:-121.3153},
  {n:'Cannon Beach',       s:'OR', lat:45.8918, lng:-123.9615},

  {n:'Philadelphia',       s:'PA', lat:39.9526, lng:-75.1652},
  {n:'Pittsburgh',         s:'PA', lat:40.4406, lng:-79.9959},
  {n:'Gettysburg',         s:'PA', lat:39.8309, lng:-77.2311},

  {n:'Newport',            s:'RI', lat:41.4901, lng:-71.3128},
  {n:'Providence',         s:'RI', lat:41.8240, lng:-71.4128},

  {n:'Myrtle Beach',       s:'SC', lat:33.6891, lng:-78.8867},
  {n:'Greenville',         s:'SC', lat:34.8526, lng:-82.3940},
  {n:'Charleston',         s:'SC', lat:32.7765, lng:-79.9311},
  {n:'Hilton Head Island', s:'SC', lat:32.2163, lng:-80.7526},

  {n:'Rapid City',         s:'SD', lat:44.0805, lng:-103.2310},
  {n:'Deadwood',           s:'SD', lat:44.3767, lng:-103.7296},

  {n:'Nashville',          s:'TN', lat:36.1627, lng:-86.7816},
  {n:'Memphis',            s:'TN', lat:35.1495, lng:-90.0490},
  {n:'Gatlinburg',         s:'TN', lat:35.7143, lng:-83.5102},

  {n:'San Antonio',        s:'TX', lat:29.4241, lng:-98.4936},
  {n:'Houston',            s:'TX', lat:29.7604, lng:-95.3698},
  {n:'Austin',             s:'TX', lat:30.2672, lng:-97.7431},

  {n:'Salt Lake City',     s:'UT', lat:40.7608, lng:-111.8910},
  {n:'Park City',          s:'UT', lat:40.6461, lng:-111.4980},
  {n:'Moab',               s:'UT', lat:38.5733, lng:-109.5498},

  {n:'Burlington',         s:'VT', lat:44.4759, lng:-73.2121},
  {n:'Stowe',              s:'VT', lat:44.4654, lng:-72.6874},

  {n:'Virginia Beach',     s:'VA', lat:36.8529, lng:-75.9780},
  {n:'Williamsburg',       s:'VA', lat:37.2707, lng:-76.7075},
  {n:'Alexandria',         s:'VA', lat:38.8048, lng:-77.0469},

  {n:'Seattle',            s:'WA', lat:47.6062, lng:-122.3321},
  {n:'Spokane',            s:'WA', lat:47.6588, lng:-117.4260},
  {n:'Leavenworth',        s:'WA', lat:47.5962, lng:-120.6615},

  {n:'Harpers Ferry',      s:'WV', lat:39.3256, lng:-77.7383},
  {n:'Lewisburg',          s:'WV', lat:37.8018, lng:-80.4459},

  {n:'Wisconsin Dells',    s:'WI', lat:43.6275, lng:-89.7710},
  {n:'Milwaukee',          s:'WI', lat:43.0389, lng:-87.9065},
  {n:'Madison',            s:'WI', lat:43.0731, lng:-89.4012},

  {n:'Jackson',            s:'WY', lat:43.4799, lng:-110.7624},
  {n:'Cody',               s:'WY', lat:44.5263, lng:-109.0565}
]
};
