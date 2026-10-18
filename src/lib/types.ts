export type Role = "user" | "business" | "admin";
export type QrStyle = "neon" | "aurora" | "matrix" | "paper";
export type RequestStatus = "pending" | "paid" | "approved" | "declined";

export interface Profile {
  id: string;
  display_name: string;
  avatar_path: string | null;
  /** only present on your own profile */
  city?: string | null;
  role: Role;
  created_at: string;
  /** only present on your own profile */
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
  owner_id?: string | null;
  cover_path?: string | null;
  logo_path?: string | null;
  links?: { kind: string; url: string; label?: string | null }[] | null;
  /** the team's check of a self-listed shop */
  verification?: "pending" | "verified" | "rejected";
  /** business type, see src/lib/modes.ts */
  kind?: string;
  contact_phone?: string | null;
}

/** A product or dish at a place. Shops add their own with photos (is_listed). */
export interface Item {
  id: string;
  place_id: string;
  topic_id: number | null;
  name: string;
  image_path: string | null;
  description: string | null;
  price_inr: number | null;
  sort_order: number;
  is_listed: boolean;
  is_hidden: boolean;
  section?: string | null;
  diet?: string[] | null;
}

export interface Friend {
  id: string;
  display_name: string | null;
  avatar_path: string | null;
  via: string;
  since: string;
  is_guest: boolean;
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
  has_qr?: boolean;
  kind?: string;
}

export interface Topic { id: number; name: string }
export interface Tag { id: number; label: string; kinds?: string[] | null }

export interface ReviewRow {
  id: string;
  /** null when the review is anonymous and isn't yours */
  user_id: string | null;
  place_id: string;
  item_id: string;
  rating: number;
  body: string;
  ai_drafted: boolean;
  verified: boolean;
  is_public: boolean;
  author_name: string | null;
  author_avatar: string | null;
  photo_path?: string | null;
  /** how it got here: a table scan or the shop's one-time link */
  source?: "table" | "link" | null;
  voice_path?: string | null;
  status: "published" | "hidden";
  created_at: string;
  items?: { name: string } | null;
  places?: { name: string; google_place_id: string | null; area: string | null } | null;
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
  plan: string | null;
  billing_interval: "month" | "year" | null;
  tables: number | null;
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

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (id?: string | null): id is string => Boolean(id && UUID_RE.test(id));
