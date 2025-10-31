
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";
import {value} from "./chain-a.ts";

export default {
  async fetch(req: Request) {
    const html = renderer.render(jsx`<div>${value}</div>`);
    return new Response(html, {
      headers: {"content-type": "text/html; charset=UTF-8"},
    });
  },
};