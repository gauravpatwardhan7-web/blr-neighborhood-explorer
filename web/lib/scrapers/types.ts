// Shared normalised listing type used by all scrapers and the API route.
export type Listing = {
  locality: string;
  source: "nobroker" | "99acres" | "housing";
  source_id: string;
  source_url: string;
  title: string;
  price: number;          // monthly rent INR
  deposit?: number;
  area_sqft?: number;
  bhk?: number;
  property_type?: string; // 'apartment' | 'independent house' | 'villa' ...
  furnishing?: string;    // 'furnished' | 'semi-furnished' | 'unfurnished'
  lat?: number;
  lon?: number;
  address?: string;
  images?: string[];
};
