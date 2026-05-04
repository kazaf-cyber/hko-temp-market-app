export type ForecastCalibrationConfig = {
  coolingScale: number;
  lateDayCapScale: number;
  meanBiasByTimeBandC: {
    overnight: number;
    morning: number;
    midday: number;
    afternoon: number;
    evening: number;
  };
  solarScoreCoefficientC: number;
  rainScoreCoefficientC: number;
  cloudPenaltyCoefficientC: number;
};

export const DEFAULT_FORECAST_CALIBRATION: ForecastCalibrationConfig = {
  coolingScale: 0.75,
  lateDayCapScale: 1.3,
  meanBiasByTimeBandC: {
    overnight: 0,
    morning: 0.05,
    midday: 0.12,
    afternoon: 0.08,
    evening: 0,
  },
  solarScoreCoefficientC: 0.002,
  rainScoreCoefficientC: -0.0015,
  cloudPenaltyCoefficientC: -0.2,
};
