import { describe, expect, it } from 'vitest';

import { getSurveysPathForSection, getSurveysSectionFromPath } from './SurveysPage';

describe('SurveysPage routing helpers', () => {
  it('maps survey analytics URLs to their sections', () => {
    expect(getSurveysSectionFromPath('/surveys')).toBe('builder');
    expect(getSurveysSectionFromPath('/surveys/clients')).toBe('clients');
    expect(getSurveysSectionFromPath('/surveys/employees')).toBe('employees');
    expect(getSurveysSectionFromPath('/surveys/ratings')).toBe('ratings');
  });

  it('builds stable URLs for survey tabs', () => {
    expect(getSurveysPathForSection('builder')).toBe('/surveys');
    expect(getSurveysPathForSection('clients')).toBe('/surveys/clients');
    expect(getSurveysPathForSection('employees')).toBe('/surveys/employees');
    expect(getSurveysPathForSection('ratings')).toBe('/surveys/ratings');
  });
});
