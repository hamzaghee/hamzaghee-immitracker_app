/**
 * Field dictionary for the Canadian Citizenship Processing Tracker.
 *
 * Taken from the tracker's own column definitions (the `data-tracker` attribute
 * on its case table), which give each opaque field id its header name. Labels
 * are the tracker's headers verbatim, so a figure in the report can be traced
 * back to the column a reader sees on the site.
 *
 * The Express Entry map lives in ../fieldMap.js. The two trackers share no
 * field ids, which is what detect.js relies on to tell their exports apart.
 */

export const citizenshipFieldToLabel = {
  'xekim-tabom-koguk-liven-mepis-fegyc-fufyt-kanac-foxex': 'Current status',
  'xelam-segit-henid-vimem-surad-selit-repaf-bykyd-hixex': 'Online/Paper Application',
  'xobac-corop-sited-dyteh-vacor-zolad-zumid-hyraz-cuxex': "Applicant's Province",
  'xobes-fezam-pinom-durar-tizeh-zydyz-husuk-vavid-laxex': "Applicant's City",
  'xelak-mibid-calol-botyt-pupog-vinyz-tivon-hutol-kexix': 'Application type',
  'xuzih-fosys-viryn-pehir-pomig-tecig-vesoz-vokuh-laxox': 'Physical Presence',
  'xusar-fybyr-mafav-roneh-mubem-babad-kegid-racad-baxyx': 'Nationality',
  'xeraf-fagen-nabeb-ducez-hasel-gelah-didat-futim-rixex': 'Application Sent Date',
  'xicar-zafuv-suziv-bobav-bekuk-sutir-pypup-dynol-baxix': 'Urgent Processing granted',
  'xotin-genyg-potum-bimup-sahuc-zylul-symav-denid-doxix': 'Primary VO',
  'xokic-titar-gutum-hihod-dahiv-necuc-rurid-genen-bixax': 'Secondary VO',
  'xusil-fyhyt-nybyb-feryc-gybiz-pegoz-bunog-nimuh-maxax': 'AOR Date',
  'xicok-zevob-nutah-tupyf-byvyc-cycuk-zyrec-nevyb-bixex': 'In-Process (ECAS) date',
  'xugof-cisyd-pyfyk-sobis-kolol-bysut-rurag-hyhak-noxix': 'Test Invite letter received date',
  'xugen-nosof-denif-rycaz-numus-vasih-tehem-bufuk-muxax': 'Testing Team Number',
  'xutim-rahaf-nesaz-cacap-sypep-hysis-dutyh-risyp-pixyx': 'Online Test Start Date',
  'xonih-tobit-gyfam-hypez-kakys-rakyz-banon-lefag-luxax': 'Online Test End Date',
  'xofic-rocyk-fukas-roric-gyzad-sebiv-fukeb-vizeh-bexix': 'Test date',
  'xiboh-rucef-hekan-saguh-kepam-hebem-vaheh-zenir-gixox': 'Test Results Updated',
  'xipol-nytod-kavor-finot-nozip-tunyc-fumug-perep-noxex': 'Language Completed',
  'xiper-motet-kakeb-vehon-setev-tipif-cifuv-fumus-kyxyx': 'Prohibitions Completed',
  'xibib-fygim-pynyt-tison-ryryv-gamut-lugyd-dacig-byxyx': 'Physical Presence Completed',
  'xopik-pigad-nacib-vemur-zevuv-borom-lybyl-lytaf-puxix': 'Background Check Completed',
  'xogob-tozof-liver-tirat-cilyr-pavyp-hirog-lativ-faxyx': 'Interview Scheduled?',
  'xonok-zovas-difaf-vatuv-tiruv-fific-rosyr-daryv-puxyx': 'Interview Scheduling Date',
  'xepem-vubal-gicor-veted-nysok-nalag-gucec-camok-cuxex': 'Fingerprint Request Received?',
  'xukok-metag-sitin-dagyz-cecus-zamul-dehih-pycut-daxax': 'Fingerprint Request Date',
  // Header says "Received?" but the column is a date, per the tracker's tooltip.
  'xedat-vorir-zygob-gyvyd-cetot-zycih-ripag-mesyb-loxyx': 'Passport Request Received?',
  'xetef-matil-nibyb-vekaf-vegil-gonud-bydak-hyfoz-pyxix': 'Decision Made (ECAS) date',
  'xumog-tupig-tybyk-luges-lozyb-temas-zucim-vucov-dyxax': 'Oath Letter date',
  'xuved-lacar-gefan-sacam-ziseh-lirib-pyfyt-meheg-nexex': 'Oath Ceremony Completion date',
  'xotih-pizoz-lotek-fyneg-gibup-lotek-sobuh-garik-zexax': 'Citizenship Certificate Received',
  'xenot-dumog-kadyp-biluv-vinyn-vuguh-kutic-byfez-zexax': 'Days from Submission to Oath Letter',
  'xucad-tohop-boceb-lebeh-dydot-lobuh-supov-sobuz-fexox': 'Days from AOR to Oath Letter',
  'xovel-vykud-lemon-bimep-tydof-peduc-hygyl-kepik-guxix': 'Notes',
  'xibem-zulul-pomes-gukyn-hyceh-bilad-nodic-kosig-suxox': 'Days from Sent to AOR',
  'xokac-bacek-dapes-nanym-cozym-givuv-sydug-beguz-pexox': 'AOR to In Progress',
  'xobim-vuhot-zudod-zahyv-vytak-todim-vohoh-pahik-zyxax': 'Days from Submission to Test Invite',
  'xocir-zivot-kutiz-kybak-dyfir-duhub-lelyb-kicek-zuxyx': 'Days from AOR to Background Check',
  'xoren-nosin-byhek-sekog-latic-bynuc-demip-fihod-pixox': 'Days from Test invite to Test',
  'xufas-goseh-rymim-hamup-lasum-kisap-cygeg-vazyf-loxax': 'Days from Test to Decision Made',
  'xorap-revit-becen-sybar-nybat-raraf-legil-dynat-syxax': 'Days from DM to Oath Letter',
  'xened-kyzul-gipor-vecid-pikis-rynyf-rafuz-raman-goxax': 'Days from Oath Letter to Oath Ceremony',
  'xutog-bypis-gisyl-zuvov-mozov-fatyd-dokyl-tohuc-mexax': 'Days from Test to Oath Letter',
};

/** Labels the analysis reads, named once so a typo fails loudly in one place. */
export const F = {
  status: 'Current status',
  channel: 'Online/Paper Application',
  province: "Applicant's Province",
  applicationType: 'Application type',
  physicalPresence: 'Physical Presence',
  nationality: 'Nationality',
  sent: 'Application Sent Date',
  urgent: 'Urgent Processing granted',
  office: 'Primary VO',
  aor: 'AOR Date',
  inProcess: 'In-Process (ECAS) date',
  testInvite: 'Test Invite letter received date',
  testingTeam: 'Testing Team Number',
  test: 'Test date',
  backgroundCheck: 'Background Check Completed',
  interview: 'Interview Scheduled?',
  interviewDate: 'Interview Scheduling Date',
  fingerprint: 'Fingerprint Request Received?',
  fingerprintDate: 'Fingerprint Request Date',
  decision: 'Decision Made (ECAS) date',
  oathLetter: 'Oath Letter date',
  oathCeremony: 'Oath Ceremony Completion date',
  certificate: 'Citizenship Certificate Received',
  notes: 'Notes',
};

/** The tracker's status values, in process order. */
export const CITIZENSHIP_STATUSES = [
  'Sent',
  'Delivered',
  'AOR',
  'In-process',
  'Test letter received',
  'Test Completed',
  'Decision Made',
  'Oath Letter received',
  'Oath completed',
];
