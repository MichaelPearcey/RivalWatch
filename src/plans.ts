/**
 * Plan definitions as data. Provisional; prices in GBP pence to avoid floats.
 * Nothing else in the codebase should hard-code these numbers.
 */
export interface Plan {
  id: string;
  name: string;
  price_pence_monthly: number;
  max_competitors: number;
  max_pages_per_competitor: number;
  /** Default check cadence for pages on this plan, in minutes. */
  check_interval_minutes: number;
  features: {
    ai_analysis: boolean;
    alerts: boolean;
    weekly_report: boolean;
    history_trends: boolean;
    comparisons: boolean;
    monthly_strategic_analysis: boolean;
  };
}

export const PLANS: Record<string, Plan> = {
  free: {
    id: "free",
    name: "Free",
    price_pence_monthly: 0,
    max_competitors: 2,
    max_pages_per_competitor: 2,
    check_interval_minutes: 7 * 24 * 60,
    features: {
      ai_analysis: true,
      alerts: false,
      weekly_report: true,
      history_trends: false,
      comparisons: false,
      monthly_strategic_analysis: false,
    },
  },
  pro: {
    id: "pro",
    name: "Pro",
    price_pence_monthly: 999,
    max_competitors: 10,
    max_pages_per_competitor: 5,
    check_interval_minutes: 24 * 60,
    features: {
      ai_analysis: true,
      alerts: true,
      weekly_report: true,
      history_trends: false,
      comparisons: false,
      monthly_strategic_analysis: false,
    },
  },
  plus: {
    id: "plus",
    name: "Plus",
    price_pence_monthly: 1999,
    max_competitors: 25,
    max_pages_per_competitor: 8,
    check_interval_minutes: 12 * 60,
    features: {
      ai_analysis: true,
      alerts: true,
      weekly_report: true,
      history_trends: true,
      comparisons: true,
      monthly_strategic_analysis: true,
    },
  },
};

export function getPlan(id: string): Plan {
  return PLANS[id] ?? PLANS.free!;
}
