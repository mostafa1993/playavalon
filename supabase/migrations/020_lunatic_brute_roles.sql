-- Migration: Add Lunatic and Brute special roles (Big Box expansion)
-- Feature: 020-lunatic-brute-roles
-- Date: 2026-01-02

-- Add new enum values to the special_role type
ALTER TYPE special_role ADD VALUE IF NOT EXISTS 'lunatic';   -- Big Box - Must fail every quest
ALTER TYPE special_role ADD VALUE IF NOT EXISTS 'brute';     -- Big Box - Can only fail quests 1-3
