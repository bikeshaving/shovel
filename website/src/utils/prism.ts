import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";

export function highlight(code: string, lang: string): string {
	const grammar = Prism.languages[lang] || Prism.languages.javascript;
	return Prism.highlight(code, grammar, lang);
}
