/**
 * Generated database types matching the schema in supabase/migrations/0001_init.sql.
 * Regenerate with: npx supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          display_name: string | null;
          avatar_url: string | null;
          bio: string | null;
          bortle_class: number | null;
          latitude: number | null;
          longitude: number | null;
          timezone: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          username: string;
          display_name?: string | null;
          avatar_url?: string | null;
          bio?: string | null;
          bortle_class?: number | null;
          latitude?: number | null;
          longitude?: number | null;
          timezone?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          username?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          bio?: string | null;
          bortle_class?: number | null;
          latitude?: number | null;
          longitude?: number | null;
          timezone?: string;
          updated_at?: string;
        };
      };
      equipment: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          type: 'telescope' | 'mount' | 'eyepiece' | 'camera' | 'filter' | 'binoculars' | 'other';
          aperture_mm: number | null;
          focal_length_mm: number | null;
          focal_ratio: number | null;
          manufacturer: string | null;
          model: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          type: 'telescope' | 'mount' | 'eyepiece' | 'camera' | 'filter' | 'binoculars' | 'other';
          aperture_mm?: number | null;
          focal_length_mm?: number | null;
          focal_ratio?: number | null;
          manufacturer?: string | null;
          model?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          name?: string;
          type?: 'telescope' | 'mount' | 'eyepiece' | 'camera' | 'filter' | 'binoculars' | 'other';
          aperture_mm?: number | null;
          focal_length_mm?: number | null;
          focal_ratio?: number | null;
          manufacturer?: string | null;
          model?: string | null;
          notes?: string | null;
        };
      };
      sessions: {
        Row: {
          id: string;
          user_id: string;
          started_at: string;
          ended_at: string | null;
          latitude: number;
          longitude: number;
          elevation_m: number | null;
          bortle_class: number | null;
          temperature_c: number | null;
          humidity_pct: number | null;
          seeing_arcsec: number | null;
          transparency: number | null;
          notes: string | null;
          is_public: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          started_at: string;
          ended_at?: string | null;
          latitude: number;
          longitude: number;
          elevation_m?: number | null;
          bortle_class?: number | null;
          temperature_c?: number | null;
          humidity_pct?: number | null;
          seeing_arcsec?: number | null;
          transparency?: number | null;
          notes?: string | null;
          is_public?: boolean;
        };
        Update: {
          ended_at?: string | null;
          bortle_class?: number | null;
          temperature_c?: number | null;
          humidity_pct?: number | null;
          seeing_arcsec?: number | null;
          transparency?: number | null;
          notes?: string | null;
          is_public?: boolean;
        };
      };
      observations: {
        Row: {
          id: string;
          session_id: string;
          user_id: string;
          target_type: 'planet' | 'moon' | 'star' | 'dso' | 'comet' | 'asteroid' | 'satellite' | 'other';
          target_name: string;
          target_catalog: string | null;
          observed_at: string;
          ra_deg: number | null;
          dec_deg: number | null;
          altitude_deg: number | null;
          azimuth_deg: number | null;
          magnitude: number | null;
          equipment_id: string | null;
          eyepiece_mm: number | null;
          magnification: number | null;
          fov_deg: number | null;
          rating: number | null;
          notes: string | null;
          sketch_url: string | null;
          is_public: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          user_id: string;
          target_type: 'planet' | 'moon' | 'star' | 'dso' | 'comet' | 'asteroid' | 'satellite' | 'other';
          target_name: string;
          target_catalog?: string | null;
          observed_at: string;
          ra_deg?: number | null;
          dec_deg?: number | null;
          altitude_deg?: number | null;
          azimuth_deg?: number | null;
          magnitude?: number | null;
          equipment_id?: string | null;
          eyepiece_mm?: number | null;
          magnification?: number | null;
          fov_deg?: number | null;
          rating?: number | null;
          notes?: string | null;
          sketch_url?: string | null;
          is_public?: boolean;
        };
        Update: {
          target_name?: string;
          target_catalog?: string | null;
          ra_deg?: number | null;
          dec_deg?: number | null;
          altitude_deg?: number | null;
          azimuth_deg?: number | null;
          magnitude?: number | null;
          equipment_id?: string | null;
          eyepiece_mm?: number | null;
          magnification?: number | null;
          fov_deg?: number | null;
          rating?: number | null;
          notes?: string | null;
          sketch_url?: string | null;
          is_public?: boolean;
        };
      };
      astrophotos: {
        Row: {
          id: string;
          observation_id: string | null;
          user_id: string;
          storage_path: string;
          thumbnail_path: string | null;
          width_px: number | null;
          height_px: number | null;
          exposure_sec: number | null;
          iso: number | null;
          gain: number | null;
          frames_stacked: number | null;
          capture_software: string | null;
          processing_notes: string | null;
          is_public: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          observation_id?: string | null;
          user_id: string;
          storage_path: string;
          thumbnail_path?: string | null;
          width_px?: number | null;
          height_px?: number | null;
          exposure_sec?: number | null;
          iso?: number | null;
          gain?: number | null;
          frames_stacked?: number | null;
          capture_software?: string | null;
          processing_notes?: string | null;
          is_public?: boolean;
        };
        Update: {
          thumbnail_path?: string | null;
          processing_notes?: string | null;
          is_public?: boolean;
        };
      };
      feed_events: {
        Row: {
          id: string;
          user_id: string;
          event_type: 'observation' | 'photo' | 'session_start' | 'session_end' | 'planet_view';
          payload: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          event_type: 'observation' | 'photo' | 'session_start' | 'session_end' | 'planet_view';
          payload?: Json;
        };
        Update: never;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
