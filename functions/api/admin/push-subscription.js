import { onRequestGetPush, onRequestPostPush, onRequestDeletePush } from "../../_shared/web-push.js";
export async function onRequestGet(context){return onRequestGetPush(context);}
export async function onRequestPost(context){return onRequestPostPush(context);}
export async function onRequestDelete(context){return onRequestDeletePush(context);}
