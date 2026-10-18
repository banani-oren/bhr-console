// Repair 32 (D6): expected working hours per workday. Oren must confirm both constants.
//  - 8.4 h: average day of a 5-day week (42 h/week ÷ 5), rayclock.co.il/work-hours-2027.html
//  - 7 h:   the day before a holiday on which the employee does not work (rayclock: the law sets a 7-hour day)
export const STANDARD_WORKDAY_HOURS = 8.4
export const EREV_HOLIDAY_HOURS = 7
