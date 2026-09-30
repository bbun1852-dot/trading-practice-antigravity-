export type CampaignStage = { 
  id: number; 
  title: string; 
  requiredTags: string[];
  intro?: {
    description: string;
    condition: string;
    method: string;
  }
};
export const CAMPAIGN_STAGES: CampaignStage[] = [
  {
    "id": 1,
    "title": "OT + 캔들의 기초 I",
    "requiredTags": [
      "candle_hammer",
      "candle_engulfing_bull"
    ]
  },
  {
    "id": 2,
    "title": "캔들의 기초 II",
    "requiredTags": [
      "candle_shooting_star",
      "candle_engulfing_bear"
    ]
  },
  {
    "id": 3,
    "title": "상승세 전환 패턴",
    "requiredTags": [
      "candle_engulfing_bull",
      "candle_morning_star"
    ]
  },
  {
    "id": 4,
    "title": "하락세 전환 패턴",
    "requiredTags": [
      "candle_engulfing_bear",
      "candle_evening_star"
    ]
  },
  {
    "id": 5,
    "title": "추세지속형 패턴",
    "requiredTags": [
      "candle_three_white_soldiers",
      "candle_three_black_crows"
    ]
  },
  {
    "id": 6,
    "title": "도지 캔들 패턴",
    "requiredTags": [
      "candle_doji"
    ]
  },
  {
    "id": 7,
    "title": "심화 캔들 패턴",
    "requiredTags": [
      "candle_doji",
      "candle_hammer",
      "candle_shooting_star"
    ]
  },
  {
    "id": 8,
    "title": "추세선의 기초",
    "requiredTags": [
      "trendline_support",
      "trendline_resistance"
    ]
  },
  {
    "id": 9,
    "title": "채널의 기초",
    "requiredTags": [
      "channel_upper",
      "channel_lower"
    ]
  },
  {
    "id": 10,
    "title": "채널 트레이딩 I",
    "requiredTags": [
      "channel_upper",
      "channel_lower"
    ]
  },
  {
    "id": 11,
    "title": "채널 트레이딩 II",
    "requiredTags": [
      "channel_upper",
      "channel_lower"
    ]
  },
  {
    "id": 12,
    "title": "채널 트레이딩 III",
    "requiredTags": [
      "channel_upper",
      "channel_lower"
    ]
  },
  {
    "id": 13,
    "title": "삼각수렴 개념편",
    "requiredTags": [
      "pattern_sym_triangle"
    ]
  },
  {
    "id": 14,
    "title": "삼각수렴 실전편",
    "requiredTags": [
      "pattern_sym_triangle",
      "pattern_asc_triangle",
      "pattern_desc_triangle"
    ]
  },
  {
    "id": 15,
    "title": "쐐기형 패턴 개념편",
    "requiredTags": [
      "pattern_rising_wedge",
      "pattern_falling_wedge"
    ]
  },
  {
    "id": 16,
    "title": "쐐기형 패턴 실전편",
    "requiredTags": [
      "pattern_rising_wedge",
      "pattern_falling_wedge"
    ]
  },
  {
    "id": 17,
    "title": "깃발형 패턴 개념편",
    "requiredTags": [
      "pattern_bull_flag",
      "pattern_bear_flag"
    ]
  },
  {
    "id": 18,
    "title": "깃발형 패턴 실전편",
    "requiredTags": [
      "pattern_bull_flag",
      "pattern_bear_flag"
    ]
  },
  {
    "id": 19,
    "title": "헤드 앤 숄더 패턴 개념편",
    "requiredTags": [
      "pattern_head_shoulders",
      "pattern_inv_head_shoulders"
    ]
  },
  {
    "id": 20,
    "title": "헤드 앤 숄더 패턴 실전편",
    "requiredTags": [
      "pattern_head_shoulders",
      "pattern_inv_head_shoulders"
    ]
  },
  {
    "id": 21,
    "title": "이중천장 패턴 개념편",
    "requiredTags": [
      "pattern_double_top"
    ]
  },
  {
    "id": 22,
    "title": "이중천장 패턴 실전편",
    "requiredTags": [
      "pattern_double_top"
    ]
  },
  {
    "id": 23,
    "title": "삼중천장 패턴 개념편",
    "requiredTags": [
      "pattern_triple_top",
      "pattern_triple_bottom"
    ]
  },
  {
    "id": 24,
    "title": "삼중천장 패턴 실전편",
    "requiredTags": [
      "pattern_triple_top",
      "pattern_triple_bottom"
    ]
  },
  {
    "id": 25,
    "title": "컵 앤 핸들 패턴 개념편",
    "requiredTags": [
      "pattern_double_bottom",
      "pattern_bull_flag"
    ]
  },
  {
    "id": 26,
    "title": "컵 앤 핸들 패턴 실전편",
    "requiredTags": [
      "pattern_double_bottom",
      "pattern_bull_flag"
    ]
  },
  {
    "id": 27,
    "title": "콰지모도 개념편",
    "requiredTags": [
      "pattern_head_shoulders",
      "choch"
    ]
  },
  {
    "id": 28,
    "title": "콰지모도 실전편",
    "requiredTags": [
      "pattern_head_shoulders",
      "choch"
    ]
  },
  {
    "id": 29,
    "title": "울프웨이브 개념편",
    "requiredTags": [
      "pattern_falling_wedge"
    ]
  },
  {
    "id": 30,
    "title": "울프웨이브 실전편",
    "requiredTags": [
      "pattern_falling_wedge"
    ]
  },
  {
    "id": 31,
    "title": "보조지표 기초",
    "requiredTags": [
      "ma_golden_cross",
      "rsi_overbought",
      "macd_golden"
    ]
  },
  {
    "id": 32,
    "title": "이동평균선",
    "requiredTags": [
      "ma_golden_cross",
      "ma_dead_cross",
      "ma_support",
      "ma_resistance"
    ]
  },
  {
    "id": 33,
    "title": "RSI 개념편",
    "requiredTags": [
      "rsi_overbought",
      "rsi_oversold"
    ]
  },
  {
    "id": 34,
    "title": "RSI 실전편",
    "requiredTags": [
      "rsi_failure_swing",
      "rsi_50_break"
    ]
  },
  {
    "id": 35,
    "title": "MACD 개념편",
    "requiredTags": [
      "macd_golden",
      "macd_dead"
    ]
  },
  {
    "id": 36,
    "title": "MACD 실전편",
    "requiredTags": [
      "macd_zero_break",
      "macd_divergence"
    ]
  },
  {
    "id": 37,
    "title": "볼린저밴드 개념편",
    "requiredTags": [
      "bb_squeeze",
      "bb_break_upper",
      "bb_break_lower"
    ]
  },
  {
    "id": 38,
    "title": "볼린저밴드 실전편",
    "requiredTags": [
      "bb_walking"
    ]
  },
  {
    "id": 39,
    "title": "스토캐스틱 개념편",
    "requiredTags": [
      "rsi_overbought"
    ]
  },
  {
    "id": 40,
    "title": "스토캐스틱 실전편",
    "requiredTags": [
      "rsi_oversold"
    ]
  },
  {
    "id": 41,
    "title": "OBV 개념편",
    "requiredTags": [
      "obv_divergence",
      "obv_trend_confirm"
    ]
  },
  {
    "id": 42,
    "title": "OBV 실전편",
    "requiredTags": [
      "obv_divergence"
    ]
  },
  {
    "id": 43,
    "title": "Wyckoff 기초편",
    "requiredTags": [
      "wyckoff_ps",
      "wyckoff_climax"
    ]
  },
  {
    "id": 44,
    "title": "Wyckoff's Accumulation",
    "requiredTags": [
      "wyckoff_ar",
      "wyckoff_st",
      "wyckoff_spring_ut"
    ]
  },
  {
    "id": 45,
    "title": "Wyckoff's Distribution",
    "requiredTags": [
      "wyckoff_utad",
      "wyckoff_test"
    ]
  },
  {
    "id": 46,
    "title": "Wyckoff's Volume Spread Analysis - Accumulation",
    "requiredTags": [
      "wyckoff_sos_sow",
      "wyckoff_lps_lpsy"
    ]
  },
  {
    "id": 47,
    "title": "Wyckoff's Volume Spread Analysis - Distribution",
    "requiredTags": [
      "wyckoff_bu",
      "wyckoff_shakeout"
    ]
  },
  {
    "id": 48,
    "title": "피보나치 분석 기초편",
    "requiredTags": [
      "fib_retrace_382",
      "fib_retrace_5",
      "fib_retrace_618"
    ]
  },
  {
    "id": 49,
    "title": "피보나치 분석 심화편",
    "requiredTags": [
      "fib_extension",
      "fib_confluence"
    ]
  },
  {
    "id": 50,
    "title": "피보나치 심화편II",
    "requiredTags": [
      "fib_extension",
      "fib_confluence"
    ]
  },
  {
    "id": 51,
    "title": "ABCD 패턴 기초편",
    "requiredTags": [
      "fib_confluence"
    ]
  },
  {
    "id": 52,
    "title": "ABCD 패턴 심화편",
    "requiredTags": [
      "fib_confluence"
    ]
  },
  {
    "id": 53,
    "title": "ABCD 패턴 심화편II",
    "requiredTags": [
      "fib_confluence"
    ]
  },
  {
    "id": 54,
    "title": "ABCD 패턴 심화편 III",
    "requiredTags": [
      "fib_confluence"
    ]
  },
  {
    "id": 55,
    "title": "하모닉 패턴 - 기초편",
    "requiredTags": [
      "fib_retrace_618",
      "pattern_double_top"
    ]
  },
  {
    "id": 56,
    "title": "하모닉 패턴 - 가틀리 패턴",
    "requiredTags": [
      "fib_retrace_618"
    ]
  },
  {
    "id": 57,
    "title": "하모닉 패턴 - 박쥐 패턴",
    "requiredTags": [
      "fib_retrace_618"
    ]
  },
  {
    "id": 58,
    "title": "하모닉 패턴 - 크랩 패턴",
    "requiredTags": [
      "fib_extension"
    ]
  },
  {
    "id": 59,
    "title": "하모닉 패턴 - 나비 패턴",
    "requiredTags": [
      "fib_extension"
    ]
  },
  {
    "id": 60,
    "title": "하모닉 패턴 - 샤크 패턴",
    "requiredTags": [
      "fib_extension"
    ]
  },
  {
    "id": 61,
    "title": "하모닉 패턴 - 사이퍼 패턴",
    "requiredTags": [
      "fib_extension"
    ]
  },
  {
    "id": 62,
    "title": "하모닉 트레이딩의 과정과 리스크 관리",
    "requiredTags": [
      "fib_confluence"
    ]
  },
  {
    "id": 63,
    "title": "하모닉 패턴 : T Bar",
    "requiredTags": [
      "fib_confluence"
    ]
  },
  {
    "id": 64,
    "title": "하모닉 패턴의 Type I, II Reversal",
    "requiredTags": [
      "fib_confluence"
    ]
  },
  {
    "id": 65,
    "title": "하모닉 패턴의 작도 방법과 거래 예시",
    "requiredTags": [
      "fib_confluence"
    ]
  },
  {
    "id": 66,
    "title": "[심화] PEZ",
    "requiredTags": [
      "fib_confluence"
    ]
  },
  {
    "id": 67,
    "title": "BAMM & RSI BAMM 테크닉 I",
    "requiredTags": [
      "fib_confluence"
    ]
  },
  {
    "id": 68,
    "title": "BAMM & RSI BAMM 테크닉 II",
    "requiredTags": [
      "fib_confluence"
    ]
  },
  {
    "id": 69,
    "title": "하모닉 패턴을 마치며",
    "requiredTags": [
      "fib_confluence"
    ]
  },
  {
    "id": 70,
    "title": "수요와 공급",
    "requiredTags": [
      "ob_bull_support",
      "ob_bear_resistance"
    ]
  },
  {
    "id": 71,
    "title": "Price Action : 지지와 저항",
    "requiredTags": [
      "sr_flip"
    ]
  },
  {
    "id": 72,
    "title": "Price Action : Market Structure에 대한 이해",
    "requiredTags": [
      "trend_up_structure",
      "trend_down_structure"
    ]
  },
  {
    "id": 73,
    "title": "Price Action : 타임프레임에 대한 이해",
    "requiredTags": [
      "htf_trend"
    ]
  },
  {
    "id": 74,
    "title": "Price Action : Range Trading I",
    "requiredTags": [
      "trend_range"
    ]
  },
  {
    "id": 75,
    "title": "Price Action : Premium & Discount",
    "requiredTags": [
      "fib_retrace_5"
    ]
  },
  {
    "id": 76,
    "title": "Price Action : Thrust & Pullback",
    "requiredTags": [
      "retest_success",
      "retest_fail"
    ]
  },
  {
    "id": 77,
    "title": "Price Action : Spring & Upthrust",
    "requiredTags": [
      "wyckoff_spring_ut"
    ]
  },
  {
    "id": 78,
    "title": "Price Action : 추세의 반전",
    "requiredTags": [
      "choch"
    ]
  },
  {
    "id": 79,
    "title": "Price Action : Swing 이론 I",
    "requiredTags": [
      "msb_bull",
      "msb_bear"
    ]
  },
  {
    "id": 80,
    "title": "Price Action : Swing 이론 II",
    "requiredTags": [
      "msb_bull",
      "msb_bear"
    ]
  },
  {
    "id": 81,
    "title": "유동성 I",
    "requiredTags": [
      "liq_pool_untapped"
    ]
  },
  {
    "id": 82,
    "title": "유동성 II",
    "requiredTags": [
      "liq_sweep_low",
      "liq_sweep_high"
    ]
  },
  {
    "id": 83,
    "title": "유동성III",
    "requiredTags": [
      "liq_sweep_low",
      "liq_sweep_high"
    ]
  },
  {
    "id": 84,
    "title": "Inefficiency",
    "requiredTags": [
      "fvg_bull",
      "fvg_bear"
    ]
  },
  {
    "id": 85,
    "title": "FVG",
    "requiredTags": [
      "fvg_bull",
      "fvg_bear",
      "fvg_rebalance"
    ]
  },
  {
    "id": 86,
    "title": "BPR",
    "requiredTags": [
      "fvg_rebalance"
    ]
  },
  {
    "id": 87,
    "title": "오더블록 I",
    "requiredTags": [
      "ob_bull_support"
    ]
  },
  {
    "id": 88,
    "title": "오더블록 II",
    "requiredTags": [
      "ob_bear_resistance"
    ]
  },
  {
    "id": 89,
    "title": "브레이커 블록",
    "requiredTags": [
      "ob_double_engulfing"
    ]
  },
  {
    "id": 90,
    "title": "세력의 함정 및 손절 유도 : Inducement",
    "requiredTags": [
      "liq_sweep_low",
      "liq_sweep_high"
    ]
  },
  {
    "id": 91,
    "title": "세력의 함정 및 손절 유도 : Stop Hunting",
    "requiredTags": [
      "liq_sweep_low",
      "liq_sweep_high"
    ]
  },
  {
    "id": 92,
    "title": "Multiple Timeframe Analysis I",
    "requiredTags": [
      "htf_trend",
      "htf_bos"
    ]
  },
  {
    "id": 93,
    "title": "Multiple Timeframe Analysis II",
    "requiredTags": [
      "htf_poi"
    ]
  },
  {
    "id": 94,
    "title": "Volume Profile",
    "requiredTags": [
      "volume_node_high",
      "volume_node_low"
    ]
  },
  {
    "id": 95,
    "title": "POC : Point Of Control",
    "requiredTags": [
      "volume_node_high"
    ]
  },
  {
    "id": 96,
    "title": "NPOC : Naked Point Of Control",
    "requiredTags": [
      "volume_node_low"
    ]
  },
  {
    "id": 97,
    "title": "POI : Point Of Interest",
    "requiredTags": [
      "htf_poi"
    ]
  },
  {
    "id": 98,
    "title": "3 Tap Setup & PO3",
    "requiredTags": [
      "fib_confluence"
    ]
  },
  {
    "id": 99,
    "title": "골든 포켓 전략",
    "requiredTags": [
      "fib_retrace_618",
      "fib_confluence"
    ]
  },
  {
    "id": 100,
    "title": "Session Trading",
    "requiredTags": [
      "vol_breakout_confirm"
    ]
  }
];