/**
 * Stock pictures behind the demo data (supabase/demo_data.sql). The demo rows keep tokens such as
 * "demo:pizza:3" instead of web addresses; demoArt.ts turns a token into a picture from here.
 *
 *   "px:<id>"          a Pexels photo (images.pexels.com/photos/<id>/pexels-photo-<id>.jpeg)
 *   "px:<id>:<file>"   a Pexels photo whose file name is not the usual one
 *   "us:<id>"          an Unsplash photo (images.unsplash.com/photo-<id>)
 *
 * `then` names the pool to try if a picture won't load; after that comes a random Lorem Picsum photo.
 */
export interface Pool { ids: string[]; then?: string }

export const POOLS: Record<string, Pool> = {
  // ---- Dishes and drinks
  pizza: { ids: ["px:825661", "px:315755", "px:1566837", "px:2147491", "px:1146760", "px:905847", "px:2619967"], then: "bistro" },
  burger: { ids: ["px:1639557", "px:1633578", "px:1199957", "px:1600727", "px:70497", "px:1639562"], then: "fries" },
  fries: { ids: ["px:1583884", "px:1633578", "px:1639562"], then: "sandwich" },
  sandwich: { ids: ["px:1600711", "px:1583884"], then: "burger" },
  pasta: { ids: ["px:1279330", "px:1437267", "px:1487511", "px:803963"], then: "bistro" },
  steak: { ids: ["px:675951", "px:3535383"], then: "grill" },
  fish: { ids: ["px:46239:salmon-dish-food-meal-46239.jpeg", "px:262959", "px:803963"], then: "bistro" },
  grill: { ids: ["px:958545", "px:2233729", "px:675951", "px:3535383"], then: "steak" },
  bistro: { ids: ["px:769289", "px:539451", "px:1435904", "px:2345975"], then: "sandwich" },
  sushi: { ids: ["px:357756", "px:2098085", "px:2323398", "px:1148086"], then: "fish" },
  noodles: { ids: ["px:884600", "px:1907228", "px:699953"], then: "momos" },
  momos: { ids: ["px:955137", "px:884600"], then: "noodles" },
  tacos: { ids: ["px:2092507", "px:4958792", "px:461198"], then: "sandwich" },
  salad: { ids: ["px:1213710", "px:1640777", "px:1640772", "px:1059905"], then: "bowl" },
  bowl: { ids: ["px:1640772", "px:1099680", "px:1092730", "px:1640777"], then: "salad" },
  breakfast: { ids: ["px:566566", "px:704569", "px:1092730", "px:221069"], then: "pancakes" },
  pancakes: { ids: ["px:376464", "px:574111", "px:221069"], then: "breakfast" },
  coffee: { ids: ["px:302899", "px:312418", "px:1251175", "px:851555", "px:2615323", "px:982612", "px:5946623"], then: "bakery" },
  tea: { ids: ["px:5946623", "us:1571934811356-5cc061b6821f", "us:1544145945-f90425340c7e", "us:1597318181409-cf64d0b5d8a2"], then: "coffee" },
  bakery: { ids: ["px:2135:food-france-morning-breakfast.jpg", "px:1775043", "us:1509440159596-0249088772ff", "us:1555507036-ab1f4038808a", "us:1517433670267-08bbd4be890f"], then: "cake" },
  bread: { ids: ["us:1606491956689-2ea866880c84", "us:1626777552726-4a6b54c97e46", "px:1775043"], then: "bakery" },
  cake: { ids: ["px:291528", "px:1126359", "px:1854652", "px:1055272", "px:45202:brownie-dessert-cake-sweet-45202.jpeg", "px:808941"], then: "donut" },
  donut: { ids: ["px:867452", "px:3594436"], then: "cake" },
  icecream: { ids: ["px:1362534", "px:1352278", "px:103566"], then: "cake" },
  sweets: { ids: ["px:867452", "px:808941", "px:3594436", "px:291528"], then: "cake" },
  juice: { ids: ["px:103566", "px:1099680", "us:1600271886742-f049cd451bba", "us:1622597467836-f3285f2131b8"], then: "cocktail" },
  cocktail: { ids: ["px:338713", "px:1187766", "us:1514362545857-3bc16c4c7d1b", "us:1470337458703-46ad1756a187", "us:1536935338788-846bb9981813"], then: "juice" },
  beer: { ids: ["us:1543007630-9710e4a00a20", "us:1532634922-8fe0b757fb13", "us:1535958636474-4bc3e5e1e1d4"], then: "cocktail" },
  // ---- Indian plates
  dosa: { ids: ["us:1630383249896-424e482df921", "us:1668236543090-82eba5ee5976", "us:1589301760014-d929f3979dbc", "us:1610192244261-3f33de3f55e4"], then: "pancakes" },
  curry: { ids: ["px:2474661", "us:1565557623262-b51c2513a641", "us:1631452180519-c014fe946bc7", "us:1596797038530-2c107229654b", "us:1567188040759-fb8a883dc6d8"], then: "grill" },
  biryani: { ids: ["px:1624487", "us:1563379091339-03b21ab4a4f8", "us:1633945274405-b6c8069047b0", "px:2474661", "us:1589302168068-964664d93dc0"], then: "curry" },
  tandoor: { ids: ["px:2233729", "us:1599487488170-d11ec9c172f0", "px:958545", "us:1603360946369-dc9bb6258143"], then: "grill" },
  chaat: { ids: ["px:955137", "us:1601050690597-df0568f70950", "us:1625220194771-7ebdea0b70b9", "px:1583884"], then: "sandwich" },
  // ---- Interiors (shop covers)
  dining: { ids: ["px:1484516", "px:262978", "us:1555396273-367ea4eb4db5", "us:1517248135467-4c7edcad34c4", "us:1552566626-52f8b828add9", "us:1514933651103-005eec06c04b"], then: "bistro" },
  cafe: { ids: ["us:1554118811-1e0d58224f24", "us:1445116572660-236099ec97a0", "us:1501339847302-ac426a4a7cbb", "us:1521017432531-fbd92d768814", "px:302899"], then: "coffee" },
  bar: { ids: ["us:1514362545857-3bc16c4c7d1b", "us:1572116469696-31de0f17cc34", "us:1555658636-6e4a36218be7", "px:338713"], then: "cocktail" },
  bakeshop: { ids: ["us:1517433670267-08bbd4be890f", "us:1555507036-ab1f4038808a", "px:2135:food-france-morning-breakfast.jpg"], then: "bakery" },
  // ---- Beauty, fitness, health, learning
  salon: { ids: ["px:3993449", "us:1560066984-138dadb4c035", "us:1521590832167-7bcbfaa6381f", "us:1562322140-8baeececf3df", "us:1522337360788-8b13dee7a37e"], then: "spa" },
  barber: { ids: ["px:1813272", "us:1503951914875-452162b0f3f1", "us:1585747860715-2ba37e788b70", "us:1599351431202-1e0f0137899a", "us:1621605815971-fbc98d665033"], then: "salon" },
  spa: { ids: ["px:3757942", "us:1540555700478-4be289fbecef", "us:1544161515-4ab6ce6db874", "us:1519823551278-64ac92734fb1", "us:1600334129128-685c5582fd35"], then: "salon" },
  nails: { ids: ["us:1604654894610-df63bc536371", "us:1596178060810-72f53ce9a65c", "us:1519014816548-bf5fe059798b"], then: "spa" },
  gym: { ids: ["px:2261477", "px:1552242", "us:1534438327276-14e5300c3a48", "us:1571019613454-1cb2f99b2d8b", "us:1517836357463-d25dfeac3438"], then: "yoga" },
  yoga: { ids: ["us:1544367567-0f2fcb009e0b", "us:1506126613408-eca07ce68773", "us:1545205597-3d9d02c29597"], then: "gym" },
  crossfit: { ids: ["us:1517963879433-6ad2b056d712", "us:1526506118085-60ce8714f8c5", "px:1552242"], then: "gym" },
  dance: { ids: ["us:1508700929628-666bc8bd84ea", "us:1545959570-a94084071b5d"], then: "yoga" },
  clinic: { ids: ["us:1576091160399-112ba8d25d1d", "us:1519494026892-80bbd2d6fd0d", "us:1538108149393-fbbd81895907", "us:1579684385127-1ef15d508118"] },
  dental: { ids: ["us:1629909613654-28e377c37b09", "us:1606811841689-23dfddce3e95", "us:1588776814546-1ffcf47267a5"], then: "clinic" },
  vet: { ids: ["us:1583337130417-3346a1be7dee", "us:1548199973-03cce0bbc87b", "us:1587300003388-59208cc962cb"] },
  pharmacy: { ids: ["us:1585435557343-3b092031a831", "us:1631549916768-4119b2e5f926", "px:3685530"], then: "clinic" },
  school: { ids: ["us:1503676260728-1c00da094a0b", "us:1580582932707-520aed937b7b", "us:1509062522246-3755977927d7", "us:1503454537195-1dcabb73ffb9"] },
  class: { ids: ["us:1523050854058-8df90110c9f1", "us:1427504494785-3a9ca7044f45", "us:1546410531-bb4caa6b424d"], then: "school" },
  // ---- Services
  garage: { ids: ["us:1486262715619-67b85e0b08d3", "us:1530046339160-ce3e530c7d2f", "us:1625047509248-ec889cbff17f"] },
  repair: { ids: ["us:1581092160562-40aa08e78837", "us:1621905251189-08b45d6a269e", "us:1585704032915-c3400ca199e7"] },
  laundry: { ids: ["us:1582735689369-4fe89db7114c", "us:1545173168-9f1947eebb7f"] },
  driving: { ids: ["us:1449965408869-eaa3f722e40d", "us:1486262715619-67b85e0b08d3"], then: "garage" },
  photo: { ids: ["px:90946", "px:51383:photo-camera-subject-photographer-51383.jpeg", "us:1516035069371-29a1b244cc32"], then: "camera" },
  cowork: { ids: ["px:18105:pexels-photo.jpg", "us:1497366216548-37526070297c", "us:1497366811353-6870744d04b2", "us:1527192491265-7e15c55b1ed2"], then: "laptop" },
  // ---- Things that are sold
  fashion: { ids: ["px:1152077", "px:2529148", "px:1598505", "px:701877", "px:46710", "us:1441986300917-64674bd600d8", "us:1445205170230-053b83016050", "us:1489987707025-afc232f7ea0f"], then: "bag" },
  bag: { ids: ["px:1152077"], then: "fashion" },
  shoes: { ids: ["px:2529148", "px:1598505", "px:19090:pexels-photo.jpg"], then: "fashion" },
  eyewear: { ids: ["px:701877", "px:46710"], then: "fashion" },
  watch: { ids: ["px:190819", "px:277390", "px:437037"], then: "fashion" },
  audio: { ids: ["px:3394650", "px:1649771"], then: "laptop" },
  laptop: { ids: ["px:18105:pexels-photo.jpg", "px:699122"], then: "audio" },
  phone: { ids: ["px:699122", "px:3394650"], then: "laptop" },
  camera: { ids: ["px:90946", "px:51383:photo-camera-subject-photographer-51383.jpeg"], then: "laptop" },
  beauty: { ids: ["px:965989", "px:3685530", "px:2533266"], then: "spa" },
  books: { ids: ["us:1481437156560-3205f6a55735", "us:1512820790803-83ca734da794", "us:1526554850534-7c78330d5f90", "us:1497633762265-9d179a990aa6"] },
  jewellery: { ids: ["us:1515562141207-7a88fb7ce338", "us:1535632066927-ab7c9ab60908", "px:190819"], then: "watch" },
  flowers: { ids: ["us:1490750967868-88aa4486c946", "us:1487530811176-3780de880c2d", "us:1561181286-d3fee7d55364"] },
  grocery: { ids: ["us:1604719312566-8912e9227c6a", "us:1542838132-92c53300491e", "us:1567401893414-76b7b1e5a7a5"] },
  shopfront: { ids: ["us:1441986300917-64674bd600d8", "us:1567401893414-76b7b1e5a7a5", "us:1472851294608-062f824d29cc"], then: "fashion" },
};
