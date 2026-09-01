/** Ordinary English function words. */
export const STOPWORDS = new Set<string>(`
a about above after again against all am an and any are aren as at be because been before being
below between both but by can cannot could couldn did didn do does doesn doing don down during each
few for from further had hadn has hasn have haven having he her here hers herself him himself his how
i if in into is isn it its itself just me mine more most my myself no nor not now of off on once only
or other ought our ours ourselves out over own same shan she should shouldn so some such than that
the their theirs them themselves then there these they this those through to too under until up very
was wasn we were weren what when where which while who whom why will with won would wouldn you your
yours yourself yourselves ll re ve s t d m im ive isnt dont doesnt cant wont
`.trim().split(/\s+/));

/**
 * Imperatives and chat filler that dominate coding prompts but carry no topic.
 * Without these, every extracted query degenerates into "please fix the file".
 */
export const CHAT_NOISE = new Set<string>(`
please thanks thank ok okay yes no yeah yep nope sure hey hi hello sorry actually just also
fix fixed fixing add added adding update updated updating make made making change changed changing
create created creating write wrote writing implement implemented implementing refactor refactored
remove removed removing delete deleted deleting rename renamed move moved run running ran try trying
check checking look looking see seeing use using need needs needed want wants wanted let lets
continue proceed go ahead keep going next again retry redo undo revert commit push pull merge stash
file files line lines code function functions method methods class classes variable variables
error errors bug bugs issue issues problem problems test tests testing failing failed pass passes
todo done finish finished complete completed working works work broken currently instead maybe
think thought thinking help helping good great nice perfect awesome cool hmm well like
now then still yet already even ever never always sometimes
something anything nothing everything someone anyone thing things stuff way ways bit lot lots
one two three first second third last final new old current previous whole entire full part
should would could shall might must may able possible right wrong better best worse
give given gives take taken takes get gets got getting put puts show shows shown tell tells
understand understanding learn learning wonder wondering curious figure figuring
heavy huge quick tricky weird nasty messy proper decent solid general actual real
`.trim().split(/\s+/));

/** Question openers that signal a genuine "teach me" moment. */
export const CONCEPT_CUES: RegExp[] = [
  /\bwhat(?:'s| is| are| does| do)\b/i,
  /\bhow (?:do(?:es)?|to|can|would|should|is|are)\b/i,
  /\bwhy (?:do(?:es)?|is|are|would|should|can)\b/i,
  /\bwhen (?:should|do|to)\b/i,
  /\b(?:explain|eli5|teach me|help me understand|walk me through|difference between|compare|versus)\b/i,
  /\b(?:the point of|meaning of|purpose of|intuition behind|intuition for)\b/i,
];

/** Phrases that mean "just do the mechanical thing" — never worth a video. */
export const MECHANICAL_CUES: RegExp[] = [
  /^\s*(?:y|n|yes|no|ok|okay|sure|thanks|ty|continue|go|go ahead|proceed|next|stop|wait|nvm|nevermind)\b/i,
  /^\s*(?:run|rerun|re-run) (?:the )?(?:tests?|build|lint|it|that)\b/i,
  /^\s*(?:commit|push|merge|rebase|stash|amend|revert)\b/i,
  /^\s*(?:fix|resolve) (?:the )?(?:typo|lint|formatting|whitespace|indent)/i,
  /^\s*(?:looks good|lgtm|perfect|nice|great|works|that works)\b/i,
  /^\s*\/\w+/,
  /^\s*@\S+\s*$/,
];
