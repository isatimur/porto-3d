// History route tasks (src/quest.js, data/quest.json): the task types a
// stop may set, the answer each one expects as a progress token
// (quest-progress.js), and a shape check shared by the route (a stop whose
// task fails it is left out) and by scripts/quest.test.mjs.
//
//   multiple_choice  question, options [{ id, ru, en, pt }], answer: option id, basis
//   visual_detail    the same, about a detail the 3D model shows
//   true_false       statement, answer: true | false, basis
//   find_on_map      target: landmark id, candidates: landmark ids, view, basis
//   sequence         items [{ id, year, label, quote }] in time order, start: ids
export const TASK_TYPES = ['multiple_choice', 'visual_detail', 'true_false', 'find_on_map', 'sequence'];
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const isId = (x) => typeof x === 'string' && ID.test(x);
const unique = (list) => new Set(list).size === list.length;

// the token a right try carries
export function answerKey(task) {
  switch (task?.type) {
    case 'multiple_choice':
    case 'visual_detail':
      return task.answer;
    case 'true_false':
      return String(task.answer);
    case 'find_on_map':
      return task.target;
    case 'sequence':
      return (task.items || []).map((it) => it.id).join(',');
    default:
      return null;
  }
}

// the problems of one task's shape; [] when it is sound
export function taskErrors(task) {
  if (!task || typeof task !== 'object') return ['no task'];
  const out = [];
  if (!isId(task.id)) out.push('task id missing or not kebab case');
  if (!TASK_TYPES.includes(task.type)) return [...out, `unknown task type «${task.type}»`];
  if (task.type === 'multiple_choice' || task.type === 'visual_detail') {
    const ids = Array.isArray(task.options) ? task.options.map((o) => o?.id) : [];
    if (ids.length < 2) out.push('fewer than two options');
    if (!ids.every(isId)) out.push('an option id is missing');
    if (!unique(ids)) out.push('duplicate option id');
    if (!ids.includes(task.answer)) out.push('answer is not an option id');
  } else if (task.type === 'true_false') {
    if (typeof task.answer !== 'boolean') out.push('answer is not true or false');
  } else if (task.type === 'find_on_map') {
    const c = Array.isArray(task.candidates) ? task.candidates : [];
    if (!isId(task.target)) out.push('target id missing');
    if (c.length < 3) out.push('fewer than three candidates');
    if (!c.every(isId)) out.push('a candidate id is missing');
    if (!unique(c)) out.push('duplicate candidate id');
    if (!c.includes(task.target)) out.push('the target is not a candidate');
  } else if (task.type === 'sequence') {
    const items = Array.isArray(task.items) ? task.items : [];
    const ids = items.map((it) => it?.id);
    if (items.length < 3 || items.length > 4) out.push('three or four items');
    if (!ids.every(isId)) out.push('an item id is missing');
    if (!unique(ids)) out.push('duplicate item id');
    if (!items.every((it, i) => Number.isInteger(it?.year) && (i === 0 || it.year > items[i - 1].year))) out.push('item years are not in rising order');
    const start = Array.isArray(task.start) ? task.start : [];
    if (start.length !== ids.length || !unique(start) || !start.every((id) => ids.includes(id))) out.push('start is not an order of the items');
    else if (start.join(',') === ids.join(',')) out.push('start is already the right order');
  }
  return out;
}

// every route's tasks, and task ids unique across the file
export function questErrors(quest) {
  const out = [];
  const seen = new Set();
  for (const r of quest?.routes || []) {
    for (const st of r.stops || []) {
      for (const e of taskErrors(st.task)) out.push(`${r.id}/${st.id}: ${e}`);
      const id = st.task?.id;
      if (isId(id)) {
        if (seen.has(id)) out.push(`${r.id}/${st.id}: duplicate task id «${id}»`);
        seen.add(id);
      }
    }
  }
  return out;
}
