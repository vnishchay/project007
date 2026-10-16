export type Role = "user" | "business" | "admin";
export type QrStyle = "neon" | "aurora" | "matrix" | "paper";
export type RequestStatus = "pending" | "paid" | "approved" | "declined";

export interface Profile {
  id: string;
  display_name: string;
  avatar_path: string | null;
  city: string | null;
  role: Role;
  created_at: string;
}

export interface Place {
  id: string;
  google_place_id: string | null;
  name: string;
  category: string;
  area: string | null;
  city: string;
  about: string | null;
  hours: Record<string, string> | null;
  price_level: number | null;
  status: "live" | "lapsed" | "removed";
  listed_until: string | null;
  created_at: string;
}

export interface SearchResult {
  place_id: string;
  name: string;
  category: string;
  area: string | null;
  price_level: number | null;
  google_place_id: string | null;
  distance_m: number | null;
  trust_score: number | null;
  review_count: number;
  verified_count: number;
  friend_count: number;
  friend_ids: string[];
  top_item: string | null;
}

export interface Topic { id: number; name: string }
export interface Tag { id: number; label: string }

export interface ReviewRow {
  id: string;
  user_id: string;
  place_id: string;
  item_id: string;
  rating: number;
  body: string;
  ai_drafted: boolean;
  visit_id: string | null;
  status: "published" | "hidden";
  created_at: string;
  items?: { name: string } | null;
  places?: { name: string; google_place_id: string | null; area: string | null } | null;
  profiles?: { display_name: string; avatar_path: string | null } | null;
  review_tags?: { tags: { label: string } | null }[];
}

export interface ListingRequest {
  id: string;
  requester_id: string;
  business_name: string;
  category: string;
  area: string | null;
  city: string;
  phone: string;
  google_place_id: string | null;
  note: string | null;
  wants_qr: boolean;
  qr_style: QrStyle | null;
  amount_inr: number;
  status: RequestStatus;
  decided_at: string | null;
  place_id: string | null;
  created_at: string;
}

export interface QrCode {
  id: string;
  place_id: string;
  token: string;
  style: QrStyle;
  table_label: string | null;
  active: boolean;
}
