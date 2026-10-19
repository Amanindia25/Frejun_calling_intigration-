import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.FREJUN_API_KEY || "";
const clientId = process.env.FREJUN_CLIENT_ID || "";
const clientSecret = process.env.FREJUN_CLIENT_SECRET || "";

async function main() {
  console.log("=== FREJUN DIAGNOSTIC TOOL ===");
  console.log("FREJUN_API_KEY:", apiKey);
  console.log("FREJUN_CALLER_NUMBER:", process.env.FREJUN_CALLER_NUMBER);

  // 1. Check user profile for anish@maxpinetechnology.com
  try {
    console.log("\n1. Fetching user info from https://api.frejun.com/api/v1/integrations/user/?email=anish@maxpinetechnology.com");
    const userRes = await axios.get("https://api.frejun.com/api/v1/integrations/user/?email=anish@maxpinetechnology.com", {
      headers: {
        "Authorization": `Api-Key ${apiKey}`,
      },
    });
    console.log("Anish User Data:", JSON.stringify(userRes.data, null, 2));
  } catch (err: any) {
    console.error("Anish user fetch error:", err.response?.status, err.response?.data || err.message);
  }


  // 2. Check virtual numbers / settings if accessible
  try {
    console.log("\n2. Checking virtual numbers / account info");
    const vnRes = await axios.get("https://api.frejun.com/api/v1/integrations/virtual-numbers/", {
      headers: {
        "Authorization": `Api-Key ${apiKey}`,
      },
    });
    console.log("Virtual numbers:", JSON.stringify(vnRes.data, null, 2));
  } catch (err: any) {
    console.log("Virtual numbers error:", err.response?.status, err.response?.data || err.message);
  }

  console.log("\n--- Testing create-call with anish@maxpinetechnology.com ---");
  const candidateNumbers = [
    "+918708050914", // New Aman Lead
    "8708050914",
  ];



  for (const cNum of candidateNumbers) {
    try {
      console.log(`Testing candidate ${cNum} with user_email: anish@maxpinetechnology.com`);
      const res = await axios.post("https://api.frejun.com/api/v1/integrations/create-call/", {
        candidate_number: cNum,
        user_email: "anish@maxpinetechnology.com",
      }, {
        headers: { "Authorization": `Api-Key ${apiKey}`, "Content-Type": "application/json" }
      });
      console.log(`SUCCESS for ${cNum}:`, res.data);
    } catch (err: any) {
      console.log(`FAILED for ${cNum}:`, err.response?.status, err.response?.data);
    }
  }
}

main().catch(console.error);




