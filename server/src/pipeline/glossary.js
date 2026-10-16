/**
 * What the report's terms mean, for the two model calls.
 *
 * The writer gets it so it uses the terms correctly — it once described
 * Submission → PPR as "submission to permanent residence". The reviewer gets
 * the same text so it can catch a term used wrongly.
 */
export const GLOSSARY = [
  ['IRCC', 'Immigration, Refugees and Citizenship Canada, the government department that processes applications.'],
  ['Express Entry', 'The system IRCC uses to manage applications for the three programs below.'],
  ['CEC', 'Canadian Experience Class: a program for people with skilled work experience in Canada.'],
  ['FSW', 'Federal Skilled Worker: a program for skilled workers, often applying from outside Canada.'],
  ['PNP', 'Provincial Nominee Program: candidates nominated by a province, which adds 600 CRS points.'],
  ['Inland / Outland', 'Whether the applicant applied from inside Canada (Inland) or from outside it (Outland). FSW-Outland, for example, means FSW applicants outside Canada.'],
  ['CRS', 'Comprehensive Ranking System: the points score that decides who is invited in a draw.'],
  ['Draw (invitation round)', 'A round in which IRCC invites candidates above a CRS cut-off to apply. A draw is either for all programs or for one category.'],
  ['Draw category', 'The group a draw targeted, such as French-language proficiency, Healthcare occupations, or All-program / General.'],
  ['ITA', 'Invitation to Apply: the invitation a candidate receives in a draw. It comes before the application is submitted.'],
  ['Submission', 'The date the applicant submitted their full application after receiving the ITA. Processing times are counted from here.'],
  ['AOR', 'Acknowledgement of Receipt: IRCC confirms it has received the application. Usually soon after submission.'],
  ['Biometrics letter', 'The request to give fingerprints and a photo.'],
  ['Medicals', 'The immigration medical exam, recorded once it is passed.'],
  ['Background check', 'Security and criminality checks. Often the longest and least predictable stage.'],
  ['ADR', 'Additional Document Request: IRCC asks the applicant for more documents during processing.'],
  ['Decision Made', 'IRCC has made its decision; the final approval request has not been sent yet.'],
  ['PPR', 'Passport Request (also called Portal 2): the final approval step, when IRCC asks for the passport to issue the visa and Confirmation of Permanent Residence. It is approval, but it is NOT becoming a permanent resident.'],
  ['Landed', 'The applicant has arrived or been confirmed in Canada and has become a permanent resident. This happens after PPR.'],
  ['Completed case', 'A case that has reached PPR. Every processing time in the report is based on completed cases only.'],
  ['Submission → PPR', 'The total processing time: days from submission to final approval (PPR). Not "to permanent residence".'],
];

/** The glossary as prompt text. */
export const glossaryText = () => GLOSSARY.map(([term, meaning]) => `- ${term}: ${meaning}`).join('\n');
