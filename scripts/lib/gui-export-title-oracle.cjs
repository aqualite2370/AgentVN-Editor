"use strict";
// Independent QA expectation: six built-in title text controls inherit this
// documented default; explicit layout style extends it. No product import.
const types = new Set(["main_menu_continue_button","main_menu_start_button","main_menu_save_load_button",
  "main_menu_gallery_button","main_menu_settings_button","main_menu_about_button"]);
const defaults = Object.freeze({backgroundColor:"transparent",borderColor:"transparent",borderWidth:0,
  borderRadius:0,color:"#f6f8ff",fontSize:18,fontWeight:600,shadow:"none",backdropBlur:0,padding:0});
function expectedExportLayout(raw) {
  const result=structuredClone(raw);
  for(const screen of result.screens)for(const c of screen.components)if(types.has(c.component_type))
    c.style=c.titleButtonStyleSource==="layout"?{...defaults,...c.style}:{...defaults};
  return result;
}
module.exports={expectedExportLayout};
