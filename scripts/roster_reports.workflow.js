// roster_reports.workflow.js — generate AI roster scouting reports for every team.
//
// Trigger (from the assistant, when the user says go):
//   Workflow({ scriptPath: 'scripts/roster_reports.workflow.js',
//              args: <contents of scripts/data/roster_inputs.json> })
//   (or args:{teams:{...subset...}} for a pilot). It returns [{name, report}]; the
//   caller merges report objects into scripts/data/roster_reports.json under teams[name].
//
// One agent per team reasons over that team's roster (depth_order = the coach's chart)
// and writes the 6-section report matching the NC State exemplar's depth + voice.

export const meta = {
  name: 'roster-reports',
  description: 'AI roster scouting reports (starters positives/flaws, bench, second unit, coach usage) per team',
  phases: [{ title: 'Report', detail: 'one agent per team writes its 6-section report' }],
}

// args may arrive as an object OR a JSON string (the tool sometimes serializes it) — handle both.
let _A = args
if (typeof _A === 'string') { try { _A = JSON.parse(_A) } catch (e) { _A = {} } }
const teams = (_A && _A.teams) ? _A.teams : (_A && !_A.teams && typeof _A === 'object' ? _A : {})
const names = Object.keys(teams)
if (!names.length) { log('no teams in args.teams — pass roster_inputs.json'); return [] }
log(`generating roster reports for ${names.length} teams`)

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['essence', 'starters', 'bench', 'second_unit', 'coach'],
  properties: {
    essence: { type: 'string', description: 'one-paragraph identity of the roster' },
    starters: {
      type: 'object', additionalProperties: false, required: ['positives', 'flaws'],
      properties: {
        positives: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'object', additionalProperties: false, required: ['t', 'b'], properties: { t: { type: 'string' }, b: { type: 'string' } } } },
        flaws: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['t', 'b'], properties: { t: { type: 'string' }, b: { type: 'string' } } } },
      },
    },
    bench: { type: 'object', additionalProperties: false, required: ['helps', 'hurts'], properties: { helps: { type: 'string' }, hurts: { type: 'string' } } },
    second_unit: { type: 'object', additionalProperties: false, required: ['strength', 'weakness'], properties: { strength: { type: 'string' }, weakness: { type: 'string' } } },
    coach: { type: 'object', additionalProperties: false, required: ['might', 'should'], properties: { might: { type: 'string' }, should: { type: 'array', minItems: 2, maxItems: 5, items: { type: 'string' } } } },
  },
}

const EXEMPLAR = `ESSENCE: A near-total portal rebuild — 10 transfers around one returner. Guard-heavy, three-point-driven: two lead-guard scorers, an elite movement shooter on the wing, a rebounding center. Lots of perimeter shot-making, real questions about size, interior defense, and who controls the ball.
STARTER POSITIVE (t/b): "Genuinely elite spacing" / "Three 39%+ shooters in the starting group — Edmead (38.7%), Hammond (39.3%), McNeil (42.7%). You cannot sag off this perimeter, which opens driving lanes."
STARTER FLAW (t/b): "Two alpha lead guards, one ball" / "Edmead was the guy at Hofstra; Hammond was the guy at Santa Clara. Playing them together is a usage collision — someone has to accept a secondary role, and neither has had to."
BENCH helps/hurts, SECOND_UNIT strength/weakness, COACH might vs should (should = 2-4 specific tactical directives). Cite numbers, name players, be sharp and honest — praise AND puncture.`

const results = await pipeline(
  names,
  (name) => {
    const t = teams[name]
    return agent(
      `You are an elite basketball scout writing a roster report for ${name} ` +
      `(head coach: ${t.coach || 'unknown'}, conference: ${t.conf || '?'}).\n\n` +
      `ROSTER — depth_order 1-5 are the coach's authored STARTERS, 6+ are the BENCH in order. ` +
      `Stats are last season's per-game; tp_pct = 3P%, grade is the player's overall (higher = better); ` +
      `transfer_from names their prior school (a portal addition). null stats = no college sample (freshman/international/unproven).\n` +
      JSON.stringify(t.players, null, 1) + `\n\n` +
      `Write the report as a real basketball mind: weigh SPACING (count the 39%+ shooters vs the non-shooters who clog the floor), ` +
      `SHOT CREATION & USAGE OVERLAP (too many alpha scorers who all need the ball?), SIZE & INTERIOR DEFENSE / rim protection (blocks, bigs), ` +
      `REBOUNDING, PLAYMAKING, CONTINUITY (returners vs a portal overhaul), and DEPTH QUALITY (the grade drop-off from starters to bench). ` +
      `Be specific — cite the numbers and name the players. Praise what's good AND puncture what's flawed. ` +
      `Coach section: "might" = the likely/obvious deployment; "should" = 2-4 sharper tactical directives that squeeze the most from THIS roster.\n\n` +
      `Match the depth and honest voice of this exemplar (a DIFFERENT team — do not reuse its content):\n${EXEMPLAR}`,
      { label: `report:${name}`, phase: 'Report', schema: SCHEMA }
    ).then((r) => ({ name, report: r })).catch(() => null)
  }
)
return results.filter(Boolean)
