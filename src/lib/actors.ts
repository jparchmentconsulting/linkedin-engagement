// The Apify actors the app depends on, named in one place so the pipeline and
// the drift canary always exercise the exact same actors and mode. If an actor
// is renamed or its mode string changes, it changes here once.
export const POSTS_ACTOR = "harvestapi~linkedin-profile-posts";
export const PROFILE_ACTOR = "harvestapi~linkedin-profile-scraper";
export const PROFILE_SCRAPER_MODE = "Profile details no email ($4 per 1k)";
