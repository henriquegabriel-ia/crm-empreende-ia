// Gerado por npm run gen:types — não edite. Fonte: supabase/migrations, via scripts/generate-types.mjs.
// Para mudar o banco, crie uma migração nova em supabase/migrations e rode npm run gen:types.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      activities: {
        Row: {
          body: string | null
          company_id: string | null
          completed_at: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          deal_id: string | null
          due_date: string | null
          end_date: string | null
          id: string
          org_id: string
          title: string
          type: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          body?: string | null
          company_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          due_date?: string | null
          end_date?: string | null
          id?: string
          org_id: string
          title: string
          type?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          body?: string | null
          company_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          due_date?: string | null
          end_date?: string | null
          id?: string
          org_id?: string
          title?: string
          type?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activities_company_id_org_id_fkey"
            columns: ["company_id", "org_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "activities_contact_id_org_id_fkey"
            columns: ["contact_id", "org_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "activities_creator_org_fkey"
            columns: ["created_by", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "activities_deal_id_org_id_fkey"
            columns: ["deal_id", "org_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "activities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_user_id_org_id_fkey"
            columns: ["user_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          changed_fields: string[]
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          org_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          changed_fields?: string[]
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          org_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          changed_fields?: string[]
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          org_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_user_id_org_id_fkey"
            columns: ["user_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      automation_logs: {
        Row: {
          activity_id: string | null
          automation_id: string | null
          automation_name: string
          created_at: string
          deal_id: string | null
          error_detail: string | null
          error_message: string | null
          id: string
          org_id: string
          status: string
        }
        Insert: {
          activity_id?: string | null
          automation_id?: string | null
          automation_name: string
          created_at?: string
          deal_id?: string | null
          error_detail?: string | null
          error_message?: string | null
          id?: string
          org_id: string
          status: string
        }
        Update: {
          activity_id?: string | null
          automation_id?: string | null
          automation_name?: string
          created_at?: string
          deal_id?: string | null
          error_detail?: string | null
          error_message?: string | null
          id?: string
          org_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_logs_activity_id_org_id_fkey"
            columns: ["activity_id", "org_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "automation_logs_automation_id_org_id_fkey"
            columns: ["automation_id", "org_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "automation_logs_deal_id_org_id_fkey"
            columns: ["deal_id", "org_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      automations: {
        Row: {
          created_at: string
          created_by: string | null
          due_days: number
          id: string
          is_active: boolean
          name: string
          org_id: string
          pipeline_id: string | null
          stage_id: string | null
          task_title: string
          trigger_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          due_days?: number
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          pipeline_id?: string | null
          stage_id?: string | null
          task_title: string
          trigger_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          due_days?: number
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          pipeline_id?: string | null
          stage_id?: string | null
          task_title?: string
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automations_created_by_org_id_fkey"
            columns: ["created_by", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "automations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automations_pipeline_id_org_id_fkey"
            columns: ["pipeline_id", "org_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "automations_stage_id_pipeline_id_org_id_fkey"
            columns: ["stage_id", "pipeline_id", "org_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id", "pipeline_id", "org_id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          domain: string | null
          id: string
          industry: string | null
          linkedin_url: string | null
          name: string
          org_id: string
          owner_id: string | null
          phone: string | null
          revenue: number | null
          size: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          created_at?: string
          domain?: string | null
          id?: string
          industry?: string | null
          linkedin_url?: string | null
          name: string
          org_id: string
          owner_id?: string | null
          phone?: string | null
          revenue?: number | null
          size?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          created_at?: string
          domain?: string | null
          id?: string
          industry?: string | null
          linkedin_url?: string | null
          name?: string
          org_id?: string
          owner_id?: string | null
          phone?: string | null
          revenue?: number | null
          size?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companies_owner_id_org_id_fkey"
            columns: ["owner_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      contacts: {
        Row: {
          company_id: string | null
          created_at: string
          email: string | null
          first_name: string
          id: string
          job_title: string | null
          last_name: string | null
          notes: string | null
          org_id: string
          owner_id: string | null
          phone: string | null
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          email?: string | null
          first_name: string
          id?: string
          job_title?: string | null
          last_name?: string | null
          notes?: string | null
          org_id: string
          owner_id?: string | null
          phone?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          email?: string | null
          first_name?: string
          id?: string
          job_title?: string | null
          last_name?: string | null
          notes?: string | null
          org_id?: string
          owner_id?: string | null
          phone?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_org_id_fkey"
            columns: ["company_id", "org_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_owner_id_org_id_fkey"
            columns: ["owner_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      deal_stage_history: {
        Row: {
          changed_by: string | null
          created_at: string
          deal_id: string
          from_stage_id: string | null
          from_status: string | null
          id: string
          org_id: string
          to_stage_id: string
          to_status: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          deal_id: string
          from_stage_id?: string | null
          from_status?: string | null
          id?: string
          org_id: string
          to_stage_id: string
          to_status: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          deal_id?: string
          from_stage_id?: string | null
          from_status?: string | null
          id?: string
          org_id?: string
          to_stage_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_stage_history_changed_by_org_id_fkey"
            columns: ["changed_by", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "deal_stage_history_deal_id_org_id_fkey"
            columns: ["deal_id", "org_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "deal_stage_history_from_stage_id_org_id_fkey"
            columns: ["from_stage_id", "org_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "deal_stage_history_to_stage_id_org_id_fkey"
            columns: ["to_stage_id", "org_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      deals: {
        Row: {
          close_date: string | null
          closed_at: string | null
          company_id: string | null
          contact_id: string | null
          created_at: string
          currency: string
          id: string
          lost_reason: string | null
          org_id: string
          owner_id: string | null
          pipeline_id: string
          probability: number | null
          stage_entered_at: string
          stage_id: string
          status: string
          title: string
          updated_at: string
          value: number
        }
        Insert: {
          close_date?: string | null
          closed_at?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          lost_reason?: string | null
          org_id: string
          owner_id?: string | null
          pipeline_id: string
          probability?: number | null
          stage_entered_at?: string
          stage_id: string
          status?: string
          title: string
          updated_at?: string
          value?: number
        }
        Update: {
          close_date?: string | null
          closed_at?: string | null
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          lost_reason?: string | null
          org_id?: string
          owner_id?: string | null
          pipeline_id?: string
          probability?: number | null
          stage_entered_at?: string
          stage_id?: string
          status?: string
          title?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "deals_company_id_org_id_fkey"
            columns: ["company_id", "org_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "deals_contact_id_org_id_fkey"
            columns: ["contact_id", "org_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "deals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_owner_id_org_id_fkey"
            columns: ["owner_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "deals_stage_id_pipeline_id_org_id_fkey"
            columns: ["stage_id", "pipeline_id", "org_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id", "pipeline_id", "org_id"]
          },
        ]
      }
      email_templates: {
        Row: {
          body: string
          created_at: string
          id: string
          name: string
          org_id: string
          subject: string
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          name: string
          org_id: string
          subject?: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_configs: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          last_checked_at: string | null
          org_id: string
          provider: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          last_checked_at?: string | null
          org_id: string
          provider: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          last_checked_at?: string | null
          org_id?: string
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_configs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          org_id: string
          role: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id: string
          role?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_invited_by_org_id_fkey"
            columns: ["invited_by", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "invitations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_progress: {
        Row: {
          dismissed_at: string | null
          id: string
          org_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          dismissed_at?: string | null
          id?: string
          org_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          dismissed_at?: string | null
          id?: string
          org_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_progress_user_id_org_id_fkey"
            columns: ["user_id", "org_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          domain: string | null
          id: string
          logo_url: string | null
          name: string
          plan: string
        }
        Insert: {
          created_at?: string
          domain?: string | null
          id?: string
          logo_url?: string | null
          name: string
          plan?: string
        }
        Update: {
          created_at?: string
          domain?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          plan?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          company_id: string | null
          contact_id: string | null
          created_at: string
          currency: string
          deal_id: string | null
          description: string
          due_date: string
          id: string
          org_id: string
          paid_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          currency?: string
          deal_id?: string | null
          description: string
          due_date: string
          id?: string
          org_id: string
          paid_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          currency?: string
          deal_id?: string | null
          description?: string
          due_date?: string
          id?: string
          org_id?: string
          paid_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_company_id_org_id_fkey"
            columns: ["company_id", "org_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "payments_contact_id_org_id_fkey"
            columns: ["contact_id", "org_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "payments_deal_id_org_id_fkey"
            columns: ["deal_id", "org_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          order: number
          org_id: string
          pipeline_id: string
          updated_at: string
          win_probability: number
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          order?: number
          org_id: string
          pipeline_id: string
          updated_at?: string
          win_probability?: number
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          order?: number
          org_id?: string
          pipeline_id?: string
          updated_at?: string
          win_probability?: number
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_pipeline_id_org_id_fkey"
            columns: ["pipeline_id", "org_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      pipelines: {
        Row: {
          created_at: string
          currency: string
          id: string
          is_default: boolean
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          is_default?: boolean
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          is_default?: boolean
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipelines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          id: string
          name: string
          onboarding_completed: boolean
          onboarding_step: number
          org_id: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          id: string
          name?: string
          onboarding_completed?: boolean
          onboarding_step?: number
          org_id?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          id?: string
          name?: string
          onboarding_completed?: boolean
          onboarding_step?: number
          org_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_rules: {
        Row: {
          enabled: boolean
          id: string
          name: string
          org_id: string
          priority: number
          threshold_days: number
          type: string
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          id?: string
          name: string
          org_id: string
          priority?: number
          threshold_days?: number
          type: string
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          id?: string
          name?: string
          org_id?: string
          priority?: number
          threshold_days?: number
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "risk_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          org_id: string
          role: string
          user_id: string
        }
        Insert: {
          id?: string
          org_id: string
          role: string
          user_id: string
        }
        Update: {
          id?: string
          org_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_org_id_fkey"
            columns: ["user_id", "org_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: {
        Args: { p_invitation_id: string }
        Returns: string
      }
      automation_log_errors: {
        Args: { p_automation_id: string }
        Returns: {
          error_detail: string
          id: string
        }[]
      }
      create_invitation: {
        Args: { p_email: string; p_role: string }
        Returns: string
      }
      create_workspace: {
        Args: { p_name: string }
        Returns: string
      }
      delete_deal: {
        Args: { p_confirm?: boolean; p_deal_id: string }
        Returns: Json
      }
      instance_status: {
        Args: never
        Returns: {
          has_organization: boolean
        }[]
      }
      move_deal: {
        Args: {
          p_deal_id: string
          p_lost_reason?: string
          p_stage_id: string
          p_status?: string
        }
        Returns: Json
      }
      search_crm: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          entity: string
          id: string
          path: string
          subtitle: string
          title: string
        }[]
      }
      set_member_role: {
        Args: { p_role: string; p_user_id: string }
        Returns: undefined
      }
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
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
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
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
