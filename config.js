// Public config — safe to ship to the browser (no secrets here).
export const CONFIG = {
  store: "https://www.nartha.in",
  supabaseUrl: "https://lkeinzvwnnmunibzeqdp.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrZWluenZ3bm5tdW5pYnplcWRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwNjU1ODIsImV4cCI6MjExMDY0MTU4Mn0.KfuuRuocb0IhU5LWX4378gG6gyEPm8Ql4xOjbmgqrNA",
  // Home page banners (same as nartha.in)
  heroSlides: [
    { img: "https://www.nartha.in/cdn/shop/files/Ultra-realistic_premium_homepage_hero_banner_202606161929_d23b9497-6c34-4147-8474-efb5dd48a450.jpg?v=1781794875", link: "#/c/butterfly-collection", alt: "Stories woven in cotton — discover the Butterfly collection" },
    { img: "https://www.nartha.in/cdn/shop/files/Replace_the_model_s_saree_in_202606161701_7a945869-51ae-43f1-8d39-21887d0b52c3.jpg?v=1781793742", link: "#/c/the-feather", alt: "Soft. Breathable. Effortless. — shop the Feather collection" },
    { img: "https://www.nartha.in/cdn/shop/files/Home_page_banner1.png?v=1781795182", link: "#/c/fiesta", alt: "Timeless elegance woven for today — explore the Fiesta collection" },
  ],
  collectionBanners: [
    { handle: "the-feather", img: "https://www.nartha.in/cdn/shop/files/Collection_block_-1_website.png?v=1781696588", alt: "Feather — soft like butter, for busy days and beautiful moments", line: "Lightweight, breathable, easy to wear. Designed for daily and office use." },
    { handle: "butterfly-collection", img: "https://www.nartha.in/cdn/shop/files/Collection_block_-2_website_1_cc83fbb9-2c0c-4244-9f52-1e5fcae1a5b5.jpg?v=1781792243", alt: "Butterfly — art in cotton, inspired by timeless Indian artistry", line: "Kalamkari sarees that carry the stories of skilled artisans." },
    { handle: "fiesta", img: "https://www.nartha.in/cdn/shop/files/Collection_block3.png?v=1781796715", alt: "Fiesta — tradition reimagined, Chettinad elegance for today", line: "Chettinad, Narayanpet and Sungudi for festivals, weddings and gifting." },
  ],
  founderImg: "https://www.nartha.in/cdn/shop/files/Confident_in_tradition_and_leadership.png",
  contact: { phone: "9566640634", email: "info@nartha.in", address: "NARTHA, HariVayuGuru Krupa, No. 9/114, Ponmuthu Nagar, Vadugapalayam, Pollachi 642001, Tamil Nadu" },
  weeklyLimit: 3, // display only — the real limit is enforced by the server (WEEKLY_LIMIT secret)
};
