import {launchTwoIndependentClients} from '../helpers/two-independent-clients.js';
export async function launchAndroidPeer(base='artifacts/android-peer'){const pair=await launchTwoIndependentClients(base);await pair.guest.close();return {client:pair.host,close:()=>pair.host.close()};}
