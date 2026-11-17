// Product events with no provider attached. emit() dispatches one
// CustomEvent on window and does nothing else: no network call, no storage,
// no identifier, no location. An analytics provider can be attached later
// by listening to this one event:
//
//   window.addEventListener('p3d:event', (e) => provider.track(e.detail.name, e.detail));
//
// e.detail, a frozen object with always these seven keys (null when unknown):
//   name     'quest_started'           a route starts at its first stop (Start, Start again)
//            'quest_step_completed'    a stop's task solved
//            'quest_completed'         the last open stop of a route solved
//            'outbound_visit_clicked'  a place card opened from a route's end screen
//   city     city id, e.g. 'porto'
//   route    route id, e.g. 'from-the-tower-to-the-river'
//   stop     landmark id of the stop, e.g. 'se-porto'
//   attempt  tries it took to solve the stop (1 = right first time), on
//            quest_step_completed only
//   type     the stop's task type, on quest_step_completed only:
//            'multiple_choice' | 'true_false' | 'find_on_map' | 'sequence' | 'visual_detail'
//   lang     interface language: 'pt' | 'en' | 'ru'
export const EVENT = 'p3d:event';

export function emit(name, { city = null, route = null, stop = null, attempt = null, type = null, lang = null } = {}) {
  const detail = Object.freeze({ name, city, route, stop, attempt, type, lang });
  // a listener's error is reported by the browser, never thrown back here
  window.dispatchEvent(new CustomEvent(EVENT, { detail }));
  return detail;
}
