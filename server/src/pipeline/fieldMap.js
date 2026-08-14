/**
 * Field dictionary — ported verbatim from the n8n "Relabel Rows" code node.
 *
 * The source dataset uses opaque generated column ids (Immitracker's internal
 * tracker field keys). This maps the 32 known ids to human labels. Unmapped ids
 * are passed through unchanged, exactly as the n8n node did.
 */

export const fieldToLabel = {
  'xodos-nymub-sovog-zolyr-kafit-finit-hyluk-cymek-bixax': 'Nationality',
  'xecat-gatas-lekyf-vymuz-hyfan-kuban-nipyc-bicos-hixux': 'Country of Residence',
  'xidar-kiboc-feruv-vazum-dazul-noror-kemip-pagit-fixix': 'Stream',
  'xopos-kybed-picys-supot-gukab-tetyl-luzyd-lekez-gixex': 'Current Status',
  'xizik-secyf-mykyk-hogef-tasas-satyr-kyhan-rumab-hixyx': 'Submitted',
  'xuset-kavav-casez-nypek-sybet-synyg-nocan-tyzef-tyxux': 'AOR Date',
  'xepot-nucyl-vycon-nivid-micim-rigal-semag-fyzyz-tixyx': 'Medical Passed',
  'xufol-codoz-vaban-rahuk-sobuc-tumyn-kesev-tikus-naxex': 'BGS Last Change Status',
  'xocoz-vubum-bifub-mitak-varab-habog-genyl-ginat-kaxyx': 'Last BGS change Date',
  'ximos-bykys-likus-nifob-nomum-nytuh-modoz-hezug-myxyx': 'Biometrics Invitation Letter',
  'xiden-fadin-lasof-dulaz-mavuk-fyzal-myhuv-humyc-tyxix': 'RPRF paid date',
  'xizon-mupof-fyzys-sogys-lipil-cyvez-lifyr-nyzic-lexix': 'Decision Made',
  'xedac-zyfyn-zylof-cedok-rahem-sirit-tafoh-pygap-poxex': 'Portal 1 Email (Inland)',
  'xufad-nuraz-bapaz-pinyt-gydoz-nenaf-kipah-rapac-texux': 'Portal 2 Email / PPR Date',
  'xemef-gigel-sydar-kosur-gyfin-pagas-tepup-dolul-saxix': 'Days from Submission to PPR',
  'xupir-vykiz-dacic-cosuh-menic-puvot-hukag-sapum-taxyx': 'Days from AOR to PPR',
  'xiseb-tybym-kiber-nakik-mybec-fufuk-nycid-gylyp-dexex': 'Landing Date (Outland)',
  'xubak-bezec-bokyh-mevid-vazab-gybaf-mysid-vibak-zexex': 'eCoPR Date (Inland Landing)',
  'xides-hibyh-pitaf-cumyz-podaz-hikub-zirug-pubek-lyxyx': 'Primary VO',
  'xobik-zodog-fabit-gakyk-mopip-cirof-kacav-bykaz-ryxox': 'Applicant & Dependents',
  'xucof-bebuc-caliv-tilur-tenyd-cezas-mutag-buvyt-sixix': 'ITA Date',
  'xogaf-ducar-fyrog-bovuf-zyzos-bibac-lefig-fukit-vexux': 'EE Draw Category',
  'xebis-lumas-tatil-cypok-tuhon-banys-cuhab-gifor-poxox': 'NOC Code',
  'xevol-dyvac-dyfaz-fyzok-cavud-ropok-pohuk-ranad-zuxax': 'Sponsored by Province (if PNP)',
  'xunop-hazat-nopas-fecis-gimuc-tikek-sahaf-hihyf-cyxex': 'CRS Score',
  'xovez-gikef-regic-cynuk-bekeb-razer-hecif-sykuz-byxox': 'CoPR Expiration Date',
  'xetel-cazyz-nomib-senum-fyhuf-cefuc-hitiv-lyhir-voxex': 'Refused',
  'xekiz-kozov-bamat-mekum-nabov-musog-ronyk-punyc-dyxex': 'Additional Document Request Date (if any)',
  'xugaz-tuhuz-kamih-mosyg-faput-lirod-romuk-napev-moxyx': 'Additional Info',
  'xorin-labez-tudat-kabys-desut-simam-nopet-gymar-zaxox': 'Number of Days after AOR to Meds passed',
  'xodih-tonov-feroz-gynad-buman-sapot-susyc-cyhih-gyxex': 'Number of days from AOR to BIL',
  'xorap-tolyp-nehov-latec-cykyp-kegor-tarac-feroc-goxux': 'Number of Days after Meds passed to PPR',
};

export const extraLabels = {
  state: 'State',
  updated: 'Last Updated',
  c_at: 'Date Created',
  comments_count: 'Comments',
  watched: 'Watched',
  dashboard: 'Dashboard',
};
