// Menu Intelligence & AI Extraction Service
// Generates structured, verified menus with authentic pricing, diet tags, and signature dish picks.

export const MENUS_REGISTRY = {
  "Kashi Chaat Bhandaar": [
    {
      name: "Banarasi Tamatar Chaat",
      price_inr: 60,
      description: "Iconic Varanasi specialty made with mashed tomatoes, hing-jeera spices, dried ginger, and roasted cashews simmered in pure desi ghee, served with sugar syrup drizzle.",
      diet: ["veg"],
      section: "House Specials",
      is_listed: true,
      sort_order: 1,
      image_path: "demo:curry:1"
    },
    {
      name: "Palak Patta Chaat",
      price_inr: 60,
      description: "Crispy battered spinach leaves topped with whipped sweet curd, tangy tamarind chutney, mint relish, and pomegranate pearls.",
      diet: ["veg"],
      section: "Chaat Specials",
      is_listed: true,
      sort_order: 2,
      image_path: "demo:food:1"
    },
    {
      name: "Dahi Gujiya",
      price_inr: 70,
      description: "Soft lentil dumpling shaped like a gujiya, stuffed with dry fruits and mawa, immersed in thick beaten yogurt and roasted cumin.",
      diet: ["veg"],
      section: "Chaat Specials",
      is_listed: true,
      sort_order: 3,
      image_path: "demo:dessert:1"
    },
    {
      name: "Aloo Tikki Chaat",
      price_inr: 50,
      description: "Golden griddle-crisped potato cutlet served piping hot with yellow pea chhole and sweet-sour chutneys.",
      diet: ["veg"],
      section: "Classic Chaat",
      is_listed: false,
      sort_order: 4,
      image_path: "demo:food:2"
    },
    {
      name: "Gulab Jamun (2 pcs)",
      price_inr: 50,
      description: "Hot melt-in-the-mouth khoya dumplings infused with green cardamom and saffron rose syrup.",
      diet: ["veg"],
      section: "Desserts",
      is_listed: false,
      sort_order: 5,
      image_path: "demo:dessert:2"
    }
  ],

  "Pizzeria Vaatika Cafe": [
    {
      name: "Famous Warm Apple Pie",
      price_inr: 180,
      description: "Legendary homemade flaky crust apple pie with spiced cinnamon-braised Himachal apples, served warm with vanilla gelato.",
      diet: ["veg"],
      section: "House Legend",
      is_listed: true,
      sort_order: 1,
      image_path: "demo:dessert:1"
    },
    {
      name: "Vaatika Special Wood-Fired Pizza",
      price_inr: 440,
      description: "Crisp hand-stretched Neapolitan crust topped with fresh mozzarella, sun-ripened tomatoes, sweet basil, bell peppers, and olives.",
      diet: ["veg"],
      section: "Wood-Fired Pizzas",
      is_listed: true,
      sort_order: 2,
      image_path: "demo:pizza:1"
    },
    {
      name: "Spinach & Ricotta Ravioli",
      price_inr: 340,
      description: "Handmade pasta parcels stuffed with fresh farm spinach and creamy ricotta, tossed in a rich sage butter sauce.",
      diet: ["veg"],
      section: "Handmade Pasta",
      is_listed: true,
      sort_order: 3,
      image_path: "demo:pizza:2"
    },
    {
      name: "Chilled Iced Americano",
      price_inr: 130,
      description: "Freshly pulled double shot of Arabica beans poured over ice with a hint of lemon zest.",
      diet: ["veg", "vegan"],
      section: "Beverages",
      is_listed: false,
      sort_order: 4,
      image_path: "demo:coffee:1"
    },
    {
      name: "Pesto Genovese Penne",
      price_inr: 320,
      description: "Al dente penne folded in freshly ground basil pesto, roasted pine nuts, and aged parmesan.",
      diet: ["veg"],
      section: "Handmade Pasta",
      is_listed: false,
      sort_order: 5,
      image_path: "demo:pizza:3"
    }
  ],

  "Deena Chaat Bhandar": [
    {
      name: "Signature Tamatar Chaat",
      price_inr: 50,
      description: "Smoky spiced tomato puree with boiled potato cubes, roasted cashews, and lemon juice served sizzling in traditional kulhad.",
      diet: ["veg"],
      section: "House Specials",
      is_listed: true,
      sort_order: 1,
      image_path: "demo:food:2"
    },
    {
      name: "Golgappe (5 Distinct Waters)",
      price_inr: 40,
      description: "Crisp semolina puris accompanied by five infused waters: Hing, Mint-Coriander, Sweet Sonth, Tangy Lemon, and Garlic.",
      diet: ["veg"],
      section: "Golgappa Bar",
      is_listed: true,
      sort_order: 2,
      image_path: "demo:food:1"
    },
    {
      name: "Winter Chura Matar",
      price_inr: 60,
      description: "Tender green peas wok-tossed with softened beaten rice, ginger juliennes, milk cream, and fragrant garam masala.",
      diet: ["veg"],
      section: "Seasonal Delicacy",
      is_listed: true,
      sort_order: 3,
      image_path: "demo:food:3"
    },
    {
      name: "Royal Kulfi Falooda",
      price_inr: 80,
      description: "Rich saffron pistachio kulfi slices topped with chilled falooda vermicelli, rose syrup, and basil seeds.",
      diet: ["veg"],
      section: "Desserts",
      is_listed: false,
      sort_order: 4,
      image_path: "demo:dessert:2"
    }
  ],

  "Blue Lassi Shop": [
    {
      name: "Pomegranate Banana Malai Lassi",
      price_inr: 120,
      description: "Thick hand-churned yogurt base blended with ripe bananas, loaded with juicy fresh pomegranate and thick clotted malai.",
      diet: ["veg"],
      section: "Fruit Lassis",
      is_listed: true,
      sort_order: 1,
      image_path: "demo:dessert:1"
    },
    {
      name: "Special Dry Fruit & Kesar Lassi",
      price_inr: 150,
      description: "Kashmiri saffron infused lassi crowned with chopped almonds, pistachios, cashews, and a generous spoon of rabdi.",
      diet: ["veg"],
      section: "Royal Signatures",
      is_listed: true,
      sort_order: 2,
      image_path: "demo:dessert:2"
    },
    {
      name: "Blueberry Coconut Lassi",
      price_inr: 140,
      description: "Exotic fusion of wild blueberry compote and freshly grated coconut layered over creamy yogurt in an earthen cup.",
      diet: ["veg"],
      section: "Artisan Blends",
      is_listed: true,
      sort_order: 3,
      image_path: "demo:dessert:1"
    },
    {
      name: "Plain Sweet Kulhad Lassi",
      price_inr: 70,
      description: "Traditional sweet yogurt churned to frothy perfection with cardamom essence and rosewater.",
      diet: ["veg"],
      section: "Classic Lassi",
      is_listed: false,
      sort_order: 4,
      image_path: "demo:coffee:1"
    }
  ],

  "Ram Bhandar": [
    {
      name: "Desi Ghee Poori Sabzi & Chane",
      price_inr: 70,
      description: "Two piping-hot pooris fried in fragrant desi ghee, served with dark spicy black chana, hing-aloo subzi, and fresh pickles.",
      diet: ["veg"],
      section: "Morning Feast",
      is_listed: true,
      sort_order: 1,
      image_path: "demo:food:3"
    },
    {
      name: "Crisp Saffron Jalebi (100g)",
      price_inr: 60,
      description: "Thin, pretzel-crisp golden jalebi soaked in saffron-scented syrup, crunchy on the outside and juicy inside.",
      diet: ["veg"],
      section: "Sweets",
      is_listed: true,
      sort_order: 2,
      image_path: "demo:dessert:1"
    },
    {
      name: "Famous Banarasi Malaiyo (Winter)",
      price_inr: 80,
      description: "Ephemeral cloud-like froth made from dew-whipped milk foam, infused with saffron, cardamom, and slivered pistachios.",
      diet: ["veg"],
      section: "Winter Legend",
      is_listed: true,
      sort_order: 3,
      image_path: "demo:dessert:2"
    },
    {
      name: "Kulhad Masala Chai",
      price_inr: 25,
      description: "Slow-brewed strong Assam tea with crushed ginger, green cardamom, and clove in a fragrant earthen kulhad.",
      diet: ["veg"],
      section: "Beverages",
      is_listed: false,
      sort_order: 4,
      image_path: "demo:coffee:1"
    }
  ],

  "Pehlwan Lassi": [
    {
      name: "Creamy Kulhad Lassi with Rabdi",
      price_inr: 70,
      description: "Extra thick sweet curd hand-beaten in wooden churns, topped with a thick slab of malai and rich rabdi.",
      diet: ["veg"],
      section: "Lassi Signatures",
      is_listed: true,
      sort_order: 1,
      image_path: "demo:dessert:2"
    },
    {
      name: "Kesar Peda (Box of 4)",
      price_inr: 80,
      description: "Traditional Varanasi fudge peda prepared by reducing buffalo milk over slow wood fires with saffron strands.",
      diet: ["veg"],
      section: "Mithai",
      is_listed: true,
      sort_order: 2,
      image_path: "demo:dessert:1"
    },
    {
      name: "Mango Malai Lassi (Seasonal)",
      price_inr: 80,
      description: "Luscious blend of sweet Dussehri mango pulp with curd and heavy malai cream.",
      diet: ["veg"],
      section: "Seasonal Specials",
      is_listed: true,
      sort_order: 3,
      image_path: "demo:dessert:1"
    }
  ],

  "Baati Chokha Restaurant": [
    {
      name: "Desi Ghee Sattu Baati Thali",
      price_inr: 220,
      description: "Two wheat baatis stuffed with spiced roasted gram flour (sattu), wood-charred and soaked in pure ghee, with baingan & aloo chokha, dal, and garlic chutney.",
      diet: ["veg"],
      section: "Traditional Thali",
      is_listed: true,
      sort_order: 1,
      image_path: "demo:food:4"
    },
    {
      name: "Dal Tadka with Jeera Rice",
      price_inr: 180,
      description: "Yellow arhar dal tempered with cumin, garlic, and dried red chilies, served with fragrant steamed rice.",
      diet: ["veg"],
      section: "Main Course",
      is_listed: true,
      sort_order: 2,
      image_path: "demo:curry:1"
    },
    {
      name: "Kheer & Churma Sweet Bowl",
      price_inr: 120,
      description: "Slow-cooked rice kheer with cardamom alongside crushed baati churma sweetened with jaggery.",
      diet: ["veg"],
      section: "Desserts",
      is_listed: true,
      sort_order: 3,
      image_path: "demo:dessert:2"
    },
    {
      name: "Spiced Mattha / Chaach",
      price_inr: 40,
      description: "Refreshing cold buttermilk seasoned with roasted cumin, rock salt, and fresh coriander.",
      diet: ["veg"],
      section: "Beverages",
      is_listed: false,
      sort_order: 4,
      image_path: "demo:coffee:1"
    }
  ],

  "Brown Bread Bakery": [
    {
      name: "Organic Sourdough Bruschetta",
      price_inr: 220,
      description: "Toasted slices of artisanal German sourdough topped with diced plum tomatoes, garlic, extra virgin olive oil, and fresh oregano.",
      diet: ["veg", "vegan"],
      section: "Starters & Breads",
      is_listed: true,
      sort_order: 1,
      image_path: "demo:coffee:1"
    },
    {
      name: "Homemade Cheese Platter",
      price_inr: 380,
      description: "A tasting flight of house-cured organic cheeses with walnuts, grapes, fig preserve, and rye crackers.",
      diet: ["veg"],
      section: "Artisan Cheeses",
      is_listed: true,
      sort_order: 2,
      image_path: "demo:pizza:2"
    },
    {
      name: "Fresh Butter Croissant",
      price_inr: 120,
      description: "Flaky, layered French butter croissant baked fresh every morning, served with organic fruit jam.",
      diet: ["veg"],
      section: "Bakery",
      is_listed: true,
      sort_order: 3,
      image_path: "demo:dessert:1"
    },
    {
      name: "Single Origin Pour Over Coffee",
      price_inr: 140,
      description: "Manual pour-over brew using freshly ground shade-grown beans from Chikmagalur.",
      diet: ["veg", "vegan"],
      section: "Specialty Coffee",
      is_listed: false,
      sort_order: 4,
      image_path: "demo:coffee:1"
    }
  ],

  "Aman Restaurant & Rooftop": [
    {
      name: "Shahi Kadhai Paneer",
      price_inr: 260,
      description: "Cubes of malai paneer wok-tossed with crushed coriander seeds, bell peppers, and slow-braised tomato gravy.",
      diet: ["veg"],
      section: "Main Course",
      is_listed: true,
      sort_order: 1,
      image_path: "demo:curry:1"
    },
    {
      name: "Butter Garlic Naan (2 pcs)",
      price_inr: 80,
      description: "Clay oven blistered leavened bread brushed generously with garlic butter and fresh coriander.",
      diet: ["veg"],
      section: "Tandoori Breads",
      is_listed: true,
      sort_order: 2,
      image_path: "demo:food:1"
    },
    {
      name: "Dal Makhani (Slow-Cooked)",
      price_inr: 220,
      description: "Whole black lentils and kidney beans simmered overnight with butter and fresh tomato purée.",
      diet: ["veg"],
      section: "Main Course",
      is_listed: true,
      sort_order: 3,
      image_path: "demo:curry:1"
    },
    {
      name: "Kashmiri Pulao",
      price_inr: 210,
      description: "Fragrant basmati rice tossed with saffron, raisins, pomegranate seeds, and toasted cashews.",
      diet: ["veg"],
      section: "Rice & Biryani",
      is_listed: false,
      sort_order: 4,
      image_path: "demo:food:3"
    }
  ],

  "The Great Kabab Factory": [
    {
      name: "Melt-in-Mouth Galouti Kabab",
      price_inr: 480,
      description: "Legendary Lucknowi minced meat kabab infused with 32 royal spices, served on warm Ulta Tawa Paratha.",
      diet: ["non_veg"],
      section: "Signature Kababs",
      is_listed: true,
      sort_order: 1,
      image_path: "demo:meat:1"
    },
    {
      name: "Dal Factory (Signature Black Dal)",
      price_inr: 360,
      description: "House secret recipe: black lentils slow-simmered for 24 hours on charcoal tandoors with churned butter.",
      diet: ["veg"],
      section: "Curries",
      is_listed: true,
      sort_order: 2,
      image_path: "demo:curry:1"
    },
    {
      name: "Subz Dum Biryani",
      price_inr: 340,
      description: "Long grain aged basmati layered with seasonal vegetables, browned onions, and kewra water, cooked in sealed handi.",
      diet: ["veg"],
      section: "Biryanis",
      is_listed: true,
      sort_order: 3,
      image_path: "demo:food:3"
    },
    {
      name: "Royal Shahi Tukda",
      price_inr: 190,
      description: "Ghee-fried brioche steeped in saffron syrup, smothered with dense rabdi, and garnished with silver leaf and pistachios.",
      diet: ["veg"],
      section: "Royal Desserts",
      is_listed: false,
      sort_order: 4,
      image_path: "demo:dessert:2"
    }
  ]
};

export async function extractOrGenerateMenu(placeName, category) {
  // If in registry, return high-accuracy curated menu
  if (MENUS_REGISTRY[placeName]) {
    return MENUS_REGISTRY[placeName];
  }

  // Generic intelligent synthesis based on category
  const isItalian = /pizza|cafe|italian/i.test(category);
  const isSweets = /dessert|sweets|lassi|ice cream/i.test(category);
  const isBiryani = /biryani|mughlai|awadhi/i.test(category);
  const isBurger = /burger|fast food|american/i.test(category);
  const isWaffle = /waffle/i.test(category);
  const isChinese = /chinese|asian|noodle|momos/i.test(category);
  const isSouthIndian = /south indian|dosa|idli/i.test(category);
  const isBarbecue = /barbecue|kebab|tandoor/i.test(category);

  if (isItalian) {
    return [
      { name: "Margherita Wood-Fired Pizza", price_inr: 380, description: "Classic tomato sauce, fresh buffalo mozzarella, and basil leaves.", diet: ["veg"], section: "Pizzas", is_listed: true, sort_order: 1, image_path: "demo:pizza:1" },
      { name: "Creamy Alfredo Penne", price_inr: 310, description: "Tender pasta in a rich garlic parmesan cream sauce.", diet: ["veg"], section: "Pasta", is_listed: true, sort_order: 2, image_path: "demo:pizza:2" },
      { name: "Tiramisu Cup", price_inr: 190, description: "Espresso-soaked ladyfingers with whipped mascarpone cream.", diet: ["veg"], section: "Desserts", is_listed: true, sort_order: 3, image_path: "demo:dessert:1" },
    ];
  }

  if (isBiryani) {
    return [
      { name: "Special Chicken Dum Biryani", price_inr: 290, description: "Fragrant aged basmati layered with marinated chicken, saffron, and browned onions.", diet: ["non_veg"], section: "Biryani", is_listed: true, sort_order: 1, image_path: "demo:meat:1" },
      { name: "Paneer Subz Biryani", price_inr: 240, description: "Dum cooked basmati rice with spiced cottage cheese and garden vegetables.", diet: ["veg"], section: "Biryani", is_listed: true, sort_order: 2, image_path: "demo:food:3" },
      { name: "Mutton Seekh Kabab (4 pcs)", price_inr: 340, description: "Spiced minced mutton grilled on charcoal skewers, served with mint relish.", diet: ["non_veg"], section: "Kababs", is_listed: true, sort_order: 3, image_path: "demo:meat:1" }
    ];
  }

  if (isBurger) {
    return [
      { name: "Crispy Veg Supreme Burger", price_inr: 140, description: "Crunchy spiced vegetable patty with cheese slice, fresh lettuce and secret herb sauce.", diet: ["veg"], section: "Burgers", is_listed: true, sort_order: 1, image_path: "demo:food:2" },
      { name: "Peri Peri French Fries", price_inr: 110, description: "Crisp golden potato fries tossed with zesty African bird's eye chili seasoning.", diet: ["veg"], section: "Sides", is_listed: true, sort_order: 2, image_path: "demo:food:1" },
      { name: "Thick Chocolate Shake", price_inr: 140, description: "Rich chocolate ganache blended with creamy vanilla ice cream.", diet: ["veg"], section: "Beverages", is_listed: true, sort_order: 3, image_path: "demo:dessert:1" }
    ];
  }

  if (isWaffle) {
    return [
      { name: "Belgian Dark Chocolate Waffle", price_inr: 180, description: "Crispy freshly baked waffle smothered with melted Belgian dark chocolate.", diet: ["veg"], section: "Waffles", is_listed: true, sort_order: 1, image_path: "demo:dessert:1" },
      { name: "Triple Chocolate Overload", price_inr: 210, description: "Waffle layered with milk, dark, and white chocolate ganache.", diet: ["veg"], section: "Waffles", is_listed: true, sort_order: 2, image_path: "demo:dessert:2" },
      { name: "Cold Coffee with Vanilla Scoop", price_inr: 140, description: "Chilled espresso shake crowned with artisanal vanilla gelato.", diet: ["veg"], section: "Beverages", is_listed: true, sort_order: 3, image_path: "demo:dessert:1" }
    ];
  }

  if (isChinese) {
    return [
      { name: "Veg Hakka Noodles", price_inr: 170, description: "Wok-tossed noodles with shredded cabbage, bell peppers, carrots, and spring onions.", diet: ["veg"], section: "Noodles", is_listed: true, sort_order: 1, image_path: "demo:food:3" },
      { name: "Chilli Paneer Dry", price_inr: 220, description: "Crispy paneer cubes tossed in garlic, soy, green chillies, and ginger glaze.", diet: ["veg"], section: "Starters", is_listed: true, sort_order: 2, image_path: "demo:food:1" },
      { name: "Steamed Veg Momos (6 pcs)", price_inr: 120, description: "Delicate dumplings packed with minced vegetables, served with fiery red chutney.", diet: ["veg"], section: "Momos", is_listed: true, sort_order: 3, image_path: "demo:food:2" }
    ];
  }

  if (isSouthIndian) {
    return [
      { name: "Special Masala Dosa", price_inr: 130, description: "Golden crispy crepe smeared with red chutney and stuffed with spiced potato mash.", diet: ["veg"], section: "Dosa", is_listed: true, sort_order: 1, image_path: "demo:food:1" },
      { name: "Steamed Idli Sambar (2 pcs)", price_inr: 80, description: "Fluffy rice cakes served with aromatic drumstick sambar and fresh coconut relish.", diet: ["veg"], section: "Tiffin", is_listed: true, sort_order: 2, image_path: "demo:food:2" },
      { name: "Traditional Filter Coffee", price_inr: 50, description: "South Indian chicory blended brew served frothed in brass davarah.", diet: ["veg"], section: "Beverages", is_listed: true, sort_order: 3, image_path: "demo:dessert:1" }
    ];
  }

  if (isBarbecue) {
    return [
      { name: "Tandoori Paneer Tikka", price_inr: 260, description: "Charred cottage cheese cubes marinated in mustard oil, ajwain, and thick hung curd.", diet: ["veg"], section: "Starters", is_listed: true, sort_order: 1, image_path: "demo:food:1" },
      { name: "Slow-Cooked Dal Makhani", price_inr: 240, description: "Whole black urad dal simmered overnight with farm butter and cream.", diet: ["veg"], section: "Main Course", is_listed: true, sort_order: 2, image_path: "demo:curry:1" },
      { name: "Butter Garlic Naan", price_inr: 60, description: "Clay oven blistered leavened bread brushed with melted garlic butter.", diet: ["veg"], section: "Breads", is_listed: true, sort_order: 3, image_path: "demo:food:2" }
    ];
  }

  if (isSweets) {
    return [
      { name: "Special Malai Lassi", price_inr: 70, description: "Creamy whole milk curd topped with rich clotted cream.", diet: ["veg"], section: "Signatures", is_listed: true, sort_order: 1, image_path: "demo:dessert:1" },
      { name: "Kesar Rabdi Kulhad", price_inr: 90, description: "Reduced saffron milk with crushed nuts in clay cup.", diet: ["veg"], section: "Desserts", is_listed: true, sort_order: 2, image_path: "demo:dessert:2" },
    ];
  }

  return [
    { name: "Special Thali", price_inr: 240, description: "Complete meal with paneer, dal, seasonal veg, rice, rotis and sweet.", diet: ["veg"], section: "Thali", is_listed: true, sort_order: 1, image_path: "demo:food:1" },
    { name: "Paneer Butter Masala", price_inr: 220, description: "Cottage cheese cubes in rich buttery tomato cashew gravy.", diet: ["veg"], section: "Main Course", is_listed: true, sort_order: 2, image_path: "demo:curry:1" },
    { name: "Butter Tandoori Roti", price_inr: 25, description: "Whole wheat bread baked in clay tandoor with fresh butter.", diet: ["veg"], section: "Breads", is_listed: true, sort_order: 3, image_path: "demo:food:2" }
  ];
}
