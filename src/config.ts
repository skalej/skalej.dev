export const SITE = {
  website: "https://YOUR-PROJECT.pages.dev/", // or "https://yourdomain.com/"
  author: "YOUR NAME",
  profile: "https://yourdomain.com/about/", // or your GitHub/LinkedIn
  desc: "Personal site of YOUR NAME. Writing about X, Y, Z.",
  title: "Saeid Kaleji",
  ogImage: "astropaper-og.jpg", // put your own image in /public if you want
  lightAndDarkMode: true,
  postPerIndex: 6,
  postPerPage: 6,
  scheduledPostMargin: 15 * 60 * 1000,
  showArchives: true,
  showBackButton: true,
  editPost: {
    enabled: false, // turn on only if you want "Edit page" links
    text: "Edit page",
    url: "https://github.com/YOURUSER/YOURREPO/edit/main/",
  },
  dynamicOgImage: true,
  dir: "ltr",
  lang: "en",
  timezone: "Europe/Berlin",
} as const;
