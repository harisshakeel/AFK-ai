export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      access_requests: {
        Row: {
          created_at: string
          email: string
          id: string
          requested_by: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          requested_by?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          requested_by?: string | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      bot_requests: {
        Row: {
          at: string
          client_key: string | null
          guest: boolean
          owner_id: string
        }
        Insert: {
          at?: string
          client_key?: string | null
          guest?: boolean
          owner_id: string
        }
        Update: {
          at?: string
          client_key?: string | null
          guest?: boolean
          owner_id?: string
        }
        Relationships: []
      }
      chapters: {
        Row: {
          first_turn_id: string
          id: string
          idx: number
          meeting_id: string
          title: string
        }
        Insert: {
          first_turn_id: string
          id?: string
          idx: number
          meeting_id: string
          title: string
        }
        Update: {
          first_turn_id?: string
          id?: string
          idx?: number
          meeting_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "chapters_first_turn_fk"
            columns: ["meeting_id", "first_turn_id"]
            isOneToOne: false
            referencedRelation: "transcript_turns"
            referencedColumns: ["meeting_id", "id"]
          },
          {
            foreignKeyName: "chapters_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      connector_secrets: {
        Row: {
          ciphertext: string
          connector_id: string
          updated_at: string
        }
        Insert: {
          ciphertext: string
          connector_id: string
          updated_at?: string
        }
        Update: {
          ciphertext?: string
          connector_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "connector_secrets_connector_id_fkey"
            columns: ["connector_id"]
            isOneToOne: true
            referencedRelation: "connectors"
            referencedColumns: ["id"]
          },
        ]
      }
      connectors: {
        Row: {
          account: string
          config: Json
          connected_at: string
          created_at: string
          expires_hint_at: string | null
          external_id: string | null
          id: string
          last_used_at: string | null
          owner_id: string
          provider: string
          revoked_at: string | null
          scopes: string[]
          status: string
          updated_at: string
        }
        Insert: {
          account: string
          config?: Json
          connected_at?: string
          created_at?: string
          expires_hint_at?: string | null
          external_id?: string | null
          id?: string
          last_used_at?: string | null
          owner_id: string
          provider: string
          revoked_at?: string | null
          scopes?: string[]
          status?: string
          updated_at?: string
        }
        Update: {
          account?: string
          config?: Json
          connected_at?: string
          created_at?: string
          expires_hint_at?: string | null
          external_id?: string | null
          id?: string
          last_used_at?: string | null
          owner_id?: string
          provider?: string
          revoked_at?: string | null
          scopes?: string[]
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          aliases: string[]
          created_at: string
          email: string
          id: string
          last_used_at: string | null
          name: string
          owner_id: string
          source: string
          updated_at: string
          uses: number
        }
        Insert: {
          aliases?: string[]
          created_at?: string
          email: string
          id?: string
          last_used_at?: string | null
          name: string
          owner_id: string
          source: string
          updated_at?: string
          uses?: number
        }
        Update: {
          aliases?: string[]
          created_at?: string
          email?: string
          id?: string
          last_used_at?: string | null
          name?: string
          owner_id?: string
          source?: string
          updated_at?: string
          uses?: number
        }
        Relationships: []
      }
      cron_runs: {
        Row: {
          id: number
          job: string
          jobs_pruned: number
          meetings: number
          pruned: number
          purged: number
          ran_at: string
          swept: number
          utterances_pruned: number
        }
        Insert: {
          id?: never
          job: string
          jobs_pruned?: number
          meetings: number
          pruned: number
          purged?: number
          ran_at?: string
          swept?: number
          utterances_pruned?: number
        }
        Update: {
          id?: never
          job?: string
          jobs_pruned?: number
          meetings?: number
          pruned?: number
          purged?: number
          ran_at?: string
          swept?: number
          utterances_pruned?: number
        }
        Relationships: []
      }
      highlights: {
        Row: {
          command_id: string | null
          created_at: string
          end_sec: number
          id: string
          meeting_id: string
          note: string | null
          owner_id: string
          start_sec: number
          updated_at: string
        }
        Insert: {
          command_id?: string | null
          created_at?: string
          end_sec: number
          id?: string
          meeting_id: string
          note?: string | null
          owner_id?: string
          start_sec: number
          updated_at?: string
        }
        Update: {
          command_id?: string | null
          created_at?: string
          end_sec?: number
          id?: string
          meeting_id?: string
          note?: string | null
          owner_id?: string
          start_sec?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "highlights_command_fk"
            columns: ["command_id"]
            isOneToOne: false
            referencedRelation: "meeting_commands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "highlights_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      item_citations: {
        Row: {
          item_id: string
          meeting_id: string
          turn_id: string
        }
        Insert: {
          item_id: string
          meeting_id: string
          turn_id: string
        }
        Update: {
          item_id?: string
          meeting_id?: string
          turn_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_citations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "meeting_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_citations_turn_fk"
            columns: ["meeting_id", "turn_id"]
            isOneToOne: false
            referencedRelation: "transcript_turns"
            referencedColumns: ["meeting_id", "id"]
          },
        ]
      }
      item_states: {
        Row: {
          done: boolean
          item_id: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          done?: boolean
          item_id: string
          owner_id?: string
          updated_at?: string
        }
        Update: {
          done?: boolean
          item_id?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_states_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "meeting_items"
            referencedColumns: ["id"]
          },
        ]
      }
      live_replies: {
        Row: {
          command_id: string
          created_at: string
          id: string
          meeting_id: string
          posted: boolean
          spoken: boolean
          text: string
        }
        Insert: {
          command_id: string
          created_at?: string
          id?: string
          meeting_id: string
          posted?: boolean
          spoken?: boolean
          text: string
        }
        Update: {
          command_id?: string
          created_at?: string
          id?: string
          meeting_id?: string
          posted?: boolean
          spoken?: boolean
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_replies_command_id_fkey"
            columns: ["command_id"]
            isOneToOne: false
            referencedRelation: "meeting_commands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_replies_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      live_utterances: {
        Row: {
          duration_ms: number
          idempotency_key: string
          is_host: boolean
          meeting_id: string
          received_at: string
          seq: number
          speaker_name: string | null
          speaker_uuid: string | null
          text: string
          timestamp_ms: number
        }
        Insert: {
          duration_ms?: number
          idempotency_key: string
          is_host?: boolean
          meeting_id: string
          received_at?: string
          seq?: never
          speaker_name?: string | null
          speaker_uuid?: string | null
          text: string
          timestamp_ms: number
        }
        Update: {
          duration_ms?: number
          idempotency_key?: string
          is_host?: boolean
          meeting_id?: string
          received_at?: string
          seq?: never
          speaker_name?: string | null
          speaker_uuid?: string | null
          text?: string
          timestamp_ms?: number
        }
        Relationships: [
          {
            foreignKeyName: "live_utterances_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_commands: {
        Row: {
          approved_args: Json | null
          approved_at: string | null
          args: Json
          created_at: string
          error: string | null
          executed_at: string | null
          finished_at: string | null
          highlight_id: string | null
          id: string
          item_id: string | null
          kind: string
          live_seq: number | null
          meeting_id: string
          needs_approval: boolean
          result: Json | null
          rewrites: number
          sentence: string
          source: string
          started_at: string | null
          status: string
          turn_id: string | null
          updated_at: string
        }
        Insert: {
          approved_args?: Json | null
          approved_at?: string | null
          args?: Json
          created_at?: string
          error?: string | null
          executed_at?: string | null
          finished_at?: string | null
          highlight_id?: string | null
          id?: string
          item_id?: string | null
          kind: string
          live_seq?: number | null
          meeting_id: string
          needs_approval?: boolean
          result?: Json | null
          rewrites?: number
          sentence: string
          source: string
          started_at?: string | null
          status?: string
          turn_id?: string | null
          updated_at?: string
        }
        Update: {
          approved_args?: Json | null
          approved_at?: string | null
          args?: Json
          created_at?: string
          error?: string | null
          executed_at?: string | null
          finished_at?: string | null
          highlight_id?: string | null
          id?: string
          item_id?: string | null
          kind?: string
          live_seq?: number | null
          meeting_id?: string
          needs_approval?: boolean
          result?: Json | null
          rewrites?: number
          sentence?: string
          source?: string
          started_at?: string | null
          status?: string
          turn_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_commands_highlight_id_fkey"
            columns: ["highlight_id"]
            isOneToOne: false
            referencedRelation: "highlights"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_commands_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "meeting_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_commands_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_commands_turn_fk"
            columns: ["meeting_id", "turn_id"]
            isOneToOne: false
            referencedRelation: "transcript_turns"
            referencedColumns: ["meeting_id", "id"]
          },
        ]
      }
      meeting_items: {
        Row: {
          command_id: string | null
          due_text: string | null
          id: string
          idx: number
          kind: string
          meeting_id: string
          owner_name: string | null
          owner_speaker_code: string | null
          section: string | null
          section_idx: number | null
          source: string
          template_key: string | null
          text: string
          tsv: unknown
        }
        Insert: {
          command_id?: string | null
          due_text?: string | null
          id?: string
          idx: number
          kind: string
          meeting_id: string
          owner_name?: string | null
          owner_speaker_code?: string | null
          section?: string | null
          section_idx?: number | null
          source?: string
          template_key?: string | null
          text: string
          tsv?: unknown
        }
        Update: {
          command_id?: string | null
          due_text?: string | null
          id?: string
          idx?: number
          kind?: string
          meeting_id?: string
          owner_name?: string | null
          owner_speaker_code?: string | null
          section?: string | null
          section_idx?: number | null
          source?: string
          template_key?: string | null
          text?: string
          tsv?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "meeting_items_command_fk"
            columns: ["command_id"]
            isOneToOne: false
            referencedRelation: "meeting_commands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_items_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_items_owner_speaker_fk"
            columns: ["meeting_id", "owner_speaker_code"]
            isOneToOne: false
            referencedRelation: "meeting_speakers"
            referencedColumns: ["meeting_id", "code"]
          },
        ]
      }
      meeting_link_tries: {
        Row: {
          client_key: string
          code: string
          failures: number
          locked_until: string | null
          updated_at: string
        }
        Insert: {
          client_key: string
          code: string
          failures?: number
          locked_until?: string | null
          updated_at?: string
        }
        Update: {
          client_key?: string
          code?: string
          failures?: number
          locked_until?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      meeting_links: {
        Row: {
          code: string
          created_at: string
          enabled: boolean
          meeting_id: string
          pin: string
          rotated_at: string | null
        }
        Insert: {
          code: string
          created_at?: string
          enabled?: boolean
          meeting_id: string
          pin: string
          rotated_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          enabled?: boolean
          meeting_id?: string
          pin?: string
          rotated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meeting_links_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: true
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_speakers: {
        Row: {
          code: string
          idx: number
          is_host: boolean
          label: string
          meeting_id: string
        }
        Insert: {
          code: string
          idx: number
          is_host?: boolean
          label: string
          meeting_id: string
        }
        Update: {
          code?: string
          idx?: number
          is_host?: boolean
          label?: string
          meeting_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_speakers_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          ai_headline: string | null
          analyzed_at: string | null
          audio_path: string | null
          bot_id: string | null
          calendar_event_id: string | null
          created_at: string
          duration_sec: number | null
          host_detected_by: string | null
          host_speaker_code: string | null
          id: string
          meeting_url: string | null
          nudged_at: string | null
          owner_id: string | null
          rating: string | null
          recorded_at: string | null
          refusal_noticed_at: string | null
          review_note: string | null
          reviewed_at: string | null
          scheduled_for: string | null
          sender_key: string | null
          sender_names: string[]
          source: Json
          status: string
          status_detail: string | null
          summarized_at: string | null
          tie_noticed_at: string | null
          title: string
          transcript_hash: string | null
          updated_at: string
          video_ref: string | null
        }
        Insert: {
          ai_headline?: string | null
          analyzed_at?: string | null
          audio_path?: string | null
          bot_id?: string | null
          calendar_event_id?: string | null
          created_at?: string
          duration_sec?: number | null
          host_detected_by?: string | null
          host_speaker_code?: string | null
          id: string
          meeting_url?: string | null
          nudged_at?: string | null
          owner_id?: string | null
          rating?: string | null
          recorded_at?: string | null
          refusal_noticed_at?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          scheduled_for?: string | null
          sender_key?: string | null
          sender_names?: string[]
          source?: Json
          status?: string
          status_detail?: string | null
          summarized_at?: string | null
          tie_noticed_at?: string | null
          title: string
          transcript_hash?: string | null
          updated_at?: string
          video_ref?: string | null
        }
        Update: {
          ai_headline?: string | null
          analyzed_at?: string | null
          audio_path?: string | null
          bot_id?: string | null
          calendar_event_id?: string | null
          created_at?: string
          duration_sec?: number | null
          host_detected_by?: string | null
          host_speaker_code?: string | null
          id?: string
          meeting_url?: string | null
          nudged_at?: string | null
          owner_id?: string | null
          rating?: string | null
          recorded_at?: string | null
          refusal_noticed_at?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          scheduled_for?: string | null
          sender_key?: string | null
          sender_names?: string[]
          source?: Json
          status?: string
          status_detail?: string | null
          summarized_at?: string | null
          tie_noticed_at?: string | null
          title?: string
          transcript_hash?: string | null
          updated_at?: string
          video_ref?: string | null
        }
        Relationships: []
      }
      memory_files: {
        Row: {
          content: string
          created_at: string
          owner_id: string
          path: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          content: string
          created_at?: string
          owner_id: string
          path: string
          updated_at?: string
          updated_by?: string
        }
        Update: {
          content?: string
          created_at?: string
          owner_id?: string
          path?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: []
      }
      processing_jobs: {
        Row: {
          attempts: number
          claim_token: string | null
          command_id: string | null
          created_at: string
          effect_at: string | null
          finished_at: string | null
          id: string
          kind: string
          last_error: string | null
          lease_until: string | null
          max_attempts: number
          meeting_id: string
          report: Json | null
          run_after: string
          started_at: string | null
          status: string
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          attempts?: number
          claim_token?: string | null
          command_id?: string | null
          created_at?: string
          effect_at?: string | null
          finished_at?: string | null
          id?: string
          kind: string
          last_error?: string | null
          lease_until?: string | null
          max_attempts?: number
          meeting_id: string
          report?: Json | null
          run_after?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          attempts?: number
          claim_token?: string | null
          command_id?: string | null
          created_at?: string
          effect_at?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          lease_until?: string | null
          max_attempts?: number
          meeting_id?: string
          report?: Json | null
          run_after?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "processing_jobs_command_id_fkey"
            columns: ["command_id"]
            isOneToOne: false
            referencedRelation: "meeting_commands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processing_jobs_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      read_hits: {
        Row: {
          at: string
          bucket: string
          key: string
        }
        Insert: {
          at?: string
          bucket: string
          key: string
        }
        Update: {
          at?: string
          bucket?: string
          key?: string
        }
        Relationships: []
      }
      share_links: {
        Row: {
          created_at: string
          highlight_id: string
          owner_id: string
          revoked_at: string | null
          token: string
        }
        Insert: {
          created_at?: string
          highlight_id: string
          owner_id?: string
          revoked_at?: string | null
          token: string
        }
        Update: {
          created_at?: string
          highlight_id?: string
          owner_id?: string
          revoked_at?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "share_links_highlight_id_fkey"
            columns: ["highlight_id"]
            isOneToOne: false
            referencedRelation: "highlights"
            referencedColumns: ["id"]
          },
        ]
      }
      transcript_turns: {
        Row: {
          end_sec: number
          id: string
          idx: number
          meeting_id: string
          speaker_code: string
          start_sec: number
          text: string
          tsv: unknown
        }
        Insert: {
          end_sec: number
          id: string
          idx: number
          meeting_id: string
          speaker_code: string
          start_sec: number
          text: string
          tsv?: unknown
        }
        Update: {
          end_sec?: number
          id?: string
          idx?: number
          meeting_id?: string
          speaker_code?: string
          start_sec?: number
          text?: string
          tsv?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "transcript_turns_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transcript_turns_speaker_fk"
            columns: ["meeting_id", "speaker_code"]
            isOneToOne: false
            referencedRelation: "meeting_speakers"
            referencedColumns: ["meeting_id", "code"]
          },
        ]
      }
      visitor_writes: {
        Row: {
          at: string
          owner_id: string
        }
        Insert: {
          at?: string
          owner_id: string
        }
        Update: {
          at?: string
          owner_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      append_memory_lines: {
        Args: {
          p_lines: string[]
          p_owner_id: string
          p_path: string
          p_template?: string
        }
        Returns: undefined
      }
      apply_analysis: {
        Args: { p_meeting_id: string; p_payload: Json }
        Returns: undefined
      }
      apply_commands: {
        Args: { p_meeting_id: string; p_payload: Json }
        Returns: undefined
      }
      apply_learned: {
        Args: { p_meeting_id: string; p_payload: Json }
        Returns: undefined
      }
      apply_summaries: {
        Args: { p_meeting_id: string; p_payload: Json }
        Returns: undefined
      }
      apply_typed_command: {
        Args: { p_command: Json; p_meeting_id: string }
        Returns: string
      }
      approve_command: {
        Args: { p_args?: Json; p_command_id: string }
        Returns: boolean
      }
      can_read_meeting: { Args: { p_meeting_id: string }; Returns: boolean }
      can_tick_item: { Args: { p_item_id: string }; Returns: boolean }
      claim_live_fallback: { Args: { p_command_id: string }; Returns: boolean }
      claim_job: {
        Args: {
          p_kinds?: string[]
          p_lease_seconds?: number
          p_meeting_id?: string
          p_worker_id: string
        }
        Returns: {
          attempts: number
          claim_token: string | null
          command_id: string | null
          created_at: string
          effect_at: string | null
          finished_at: string | null
          id: string
          kind: string
          last_error: string | null
          lease_until: string | null
          max_attempts: number
          meeting_id: string
          report: Json | null
          run_after: string
          started_at: string | null
          status: string
          updated_at: string
          worker_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "processing_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_job: {
        Args: {
          p_claim_token: string
          p_error?: string
          p_job_id: string
          p_outcome: string
          p_payload?: Json
          p_report?: Json
          p_retry_at?: string
        }
        Returns: boolean
      }
      dismiss_command: { Args: { p_command_id: string }; Returns: boolean }
      finish_command: {
        Args: { p_command_id: string; p_payload: Json }
        Returns: undefined
      }
      finish_ingest: {
        Args: {
          p_audio_path?: string
          p_meeting_id: string
          p_video_ref?: string
        }
        Returns: boolean
      }
      finish_live_answer: {
        Args: { p_command_id: string; p_payload: Json }
        Returns: undefined
      }
      get_shared_clip: { Args: { p_token: string }; Returns: Json }
      get_shared_meeting: { Args: { p_code: string }; Returns: Json }
      import_generated: {
        Args: {
          p_kind: string
          p_meeting_id: string
          p_payload: Json
          p_transcript_hash: string
        }
        Returns: boolean
      }
      ingest_transcript: {
        Args: {
          p_duration_sec: number
          p_hash: string
          p_meeting_id: string
          p_speakers: Json
          p_turns: Json
        }
        Returns: boolean
      }
      is_google_user: { Args: never; Returns: boolean }
      is_guest: { Args: { p_user_id: string }; Returns: boolean }
      job_failed_for_good: {
        Args: {
          p_command_id: string
          p_error: string
          p_kind: string
          p_meeting_id: string
        }
        Returns: undefined
      }
      learn_contacts: {
        Args: {
          p_owner_id: string
          p_people: Json
          p_source: string
          p_used?: boolean
        }
        Returns: number
      }
      list_meetings: {
        Args: {
          p_before_created?: string
          p_before_id?: string
          p_before_recorded?: string
          p_limit?: number
          p_own: boolean
        }
        Returns: {
          ai_headline: string
          created_at: string
          duration_sec: number
          id: string
          owner_id: string
          recorded_at: string
          speakers: Json
          status: string
          status_detail: string
          title: string
        }[]
      }
      live_speaker_names: { Args: { p_meeting_id: string }; Returns: string[] }
      mark_bot_finished: {
        Args: { p_bot_id: string; p_detail?: string; p_succeeded: boolean }
        Returns: string
      }
      new_link_code: { Args: never; Returns: string }
      new_link_pin: { Args: never; Returns: string }
      note_meeting_in_history: {
        Args: { p_meeting_id: string }
        Returns: undefined
      }
      note_read_hit: {
        Args: { p_bucket: string; p_key: string; p_limit: number }
        Returns: boolean
      }
      note_visitor_write: { Args: never; Returns: boolean }
      open_meeting_link: {
        Args: { p_client_key: string; p_code: string; p_pin: string }
        Returns: Json
      }
      prune_finished_jobs: { Args: { p_older_than?: string }; Returns: number }
      prune_link_tries: { Args: never; Returns: number }
      prune_live_utterances: {
        Args: { p_older_than?: string }
        Returns: number
      }
      purge_stale_guests: { Args: { p_older_than?: string }; Returns: Json }
      queue_status: {
        Args: never
        Returns: {
          failed_day: number
          oldest_runnable_sec: number
          runnable: number
          running: number
          scheduled: number
        }[]
      }
      record_live_utterance: {
        Args: {
          p_bot_id: string
          p_command?: Json
          p_duration_ms: number
          p_idempotency_key: string
          p_is_host: boolean
          p_speaker_name: string
          p_speaker_uuid: string
          p_text: string
          p_timestamp_ms: number
        }
        Returns: {
          command_id: string
          duplicate: boolean
          meeting_id: string
          seq: number
        }[]
      }
      review_meeting: {
        Args: { p_meeting_id: string; p_note?: string; p_rating?: string }
        Returns: boolean
      }
      rewrite_command: {
        Args: { p_command_id: string; p_note: string }
        Returns: boolean
      }
      rotate_meeting_link: { Args: { p_meeting_id: string }; Returns: boolean }
      save_memory_file: {
        Args: {
          p_content: string
          p_expected_updated_at?: string
          p_path: string
        }
        Returns: string
      }
      search_meetings: {
        Args: { p_limit?: number; p_own_only?: boolean; p_query: string }
        Returns: {
          kind: string
          meeting_id: string
          rank: number
          ref_id: string
          snippet: string
          speaker_code: string
          start_sec: number
        }[]
      }
      set_meeting_link_enabled: {
        Args: { p_enabled: boolean; p_meeting_id: string }
        Returns: boolean
      }
      snooze_wrap_up: { Args: { p_meeting_id: string }; Returns: boolean }
      start_command: {
        Args: { p_claim_token: string; p_command_id: string; p_job_id: string }
        Returns: string
      }
      start_job_effect: {
        Args: { p_claim_token: string; p_job_id: string }
        Returns: string
      }
      store_connector: {
        Args: {
          p_account: string
          p_ciphertext: string
          p_config: Json
          p_expires_hint_at?: string
          p_external_id: string
          p_owner_id: string
          p_provider: string
          p_scopes: string[]
        }
        Returns: string
      }
      sweep_stale_bots: { Args: { p_older_than?: string }; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
