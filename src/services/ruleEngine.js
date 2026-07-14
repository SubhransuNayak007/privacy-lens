export function evaluateTrackerImpact(context) {
  const { tracker, firstParty, userActivity } = context;
  const category = (tracker.category || "").toLowerCase();
  const purpose = (tracker.purpose || "").toLowerCase();
  
  let recommendation = "Review";
  const evidence = [];
  
  if (!firstParty) {
    evidence.push("Third-party request");
  } else {
    evidence.push("First-party request");
  }

  const isAuth = category.includes("auth") || purpose.includes("auth") || tracker.domain.includes("accounts");
  const isPayment = category.includes("payment") || purpose.includes("payment") || tracker.domain.includes("stripe") || tracker.domain.includes("paypal");
  const isCDN = category.includes("cdn") || purpose.includes("content delivery");
  const isCaptcha = category.includes("captcha") || purpose.includes("bot protection");
  const isAds = category.includes("advertis") || purpose.includes("advertis");
  const isAnalytics = category.includes("analytic") || purpose.includes("analytic") || category.includes("measurement");
  const isVideo = category.includes("video") || purpose.includes("video") || category.includes("media");

  if (isAds) evidence.push("Advertising network");
  else if (isAnalytics) evidence.push("Telemetry and analytics");
  
  // Smart Activity Overrides
  if (userActivity === "Watching Video") {
    evidence.push("Active while watching a video");
    if (isVideo || isCDN) {
      recommendation = "Essential";
      evidence.push("Required for video playback");
    } else if (isAds || isAnalytics) {
      recommendation = "Safe to Block";
      evidence.push("Not required for video playback");
    }
  } else if (userActivity === "Uploading File") {
    evidence.push("Active during file upload");
    if (isCDN || category.includes("storage")) {
      recommendation = "Essential";
      evidence.push("Required for file upload");
    } else if (isAds || isAnalytics) {
      recommendation = "Probably Safe";
    }
  } else if (userActivity === "Logging In / Signing Up") {
    evidence.push("Active during authentication");
    if (isAuth || isCaptcha) {
      recommendation = "Essential";
      evidence.push("Required for login");
    } else if (isAnalytics || isAds) {
      recommendation = "Review";
      evidence.push("Non-essential tracker active during sensitive input");
    }
  } else if (userActivity === "Making Payment") {
    evidence.push("Active during checkout/payment");
    if (isPayment || isAuth) {
      recommendation = "Essential";
      evidence.push("Required for processing payment");
    } else if (isAds || isAnalytics) {
      recommendation = "Review";
      evidence.push("Non-essential tracker active during payment");
    }
  } else if (userActivity === "Filling Form") {
    evidence.push("Active while filling out a form");
    if (isAds) {
      recommendation = "Review";
      evidence.push("Ad tracker observing form input");
    } else if (isCaptcha) {
      recommendation = "Essential";
    }
  } else {
    // Default Rule Engine
    if (isAuth) {
      recommendation = "Essential";
      evidence.push("Required for authentication/login");
    } else if (isPayment) {
      recommendation = "Essential";
      evidence.push("Required for payment processing");
    } else if (isCaptcha) {
      recommendation = "Essential";
      evidence.push("Required for bot protection/security");
    } else if (isCDN) {
      recommendation = "Probably Safe";
      evidence.push("Likely provides core website assets");
    } else if (isAds) {
      recommendation = "Safe to Block";
      evidence.push("Not required for core functionality");
    } else if (isAnalytics) {
      recommendation = "Safe to Block";
      evidence.push("Does not impact page rendering");
    }
  }

  return {
    recommendation,
    evidence
  };
}
