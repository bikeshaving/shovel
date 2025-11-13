import {allFakers} from "@faker-js/faker";

const available = Object.keys(allFakers).sort();
const hardcoded = [
	"en_US",
	"en_CA",
	"en_GB",
	"fr_FR",
	"de_DE",
	"es_ES",
	"it_IT",
	"pt_BR",
	"ja_JP",
	"ko_KR",
	"zh_CN",
	"ru_RU",
	"nl_NL",
	"sv_SE",
	"no_NO",
	"da_DK",
	"fi_FI",
	"pl_PL",
	"cs_CZ",
	"hu_HU",
	"ar_SA",
	"he_IL",
	"tr_TR",
	"th_TH",
	"vi_VN",
	"id_ID",
	"hi_IN",
	"ur_PK",
	"bn_BD",
	"ta_LK",
	"ne_NP",
];

console.info("[CheckLocales] Invalid locales in your hardcoded list:");
const invalid = hardcoded.filter((loc) => !available.includes(loc));
invalid.forEach((loc) => console.info("  " + loc));

console.info("\n[CheckLocales] Valid locales in your hardcoded list:");
const valid = hardcoded.filter((loc) => available.includes(loc));
valid.forEach((loc) => console.info("  " + loc));

console.info("\n[CheckLocales] Summary:");
console.info(`  Total hardcoded: ${hardcoded.length}`);
console.info(`  Valid: ${valid.length}`);
console.info(`  Invalid: ${invalid.length}`);
console.info(`  Available in Faker.js: ${available.length}`);

console.info("\n[CheckLocales] Suggested corrections:");
const corrections = {
	fr_FR: "fr",
	de_DE: "de",
	es_ES: "es",
	it_IT: "it",
	ja_JP: "ja",
	ko_KR: "ko",
	nl_NL: "nl",
	sv_SE: "sv",
	no_NO: "nb_NO",
	da_DK: "da",
	fi_FI: "fi",
	pl_PL: "pl",
	hu_HU: "hu",
	ar_SA: "ar",
	he_IL: "he",
	tr_TR: "tr",
	th_TH: "th",
	vi_VN: "vi",
	ur_PK: "ur",
	ne_NP: "ne",
};

Object.entries(corrections).forEach(([wrong, correct]) => {
	if (invalid.includes(wrong)) {
		console.info(`  ${wrong} → ${correct}`);
	}
});
