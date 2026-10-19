# MouseMux 3.0.19 analysis for CoLaB

Date: 2026-10-19. The nine requested files were inspected read-only from the installed `MouseMux V3/store/3.0.19/bin32` directory. Vendor entrypoints were not executed. Raw evidence and decompilation stay outside this repository in the local `mousemux-analysis` directory.

## Inventory

Every requested file is PE x86, machine `0x014c`.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| dbghelp.dll | 1215608 | d02cbb667150a927cf2c97e64592e882e1edf055dc5fe292a933ed32cf0523b3 |
| exchndl.dll | 37000 | 5678485b413ada98c8a11bcd6c2f1658cf80d1a77009979fa82ff9f1371b63da |
| mgwhelp.dll | 519816 | c566f6e2a36090f03ebee0e6fec4d43b2ab0feb361d1bed0123da9e54c09365c |
| mousemux-v3-reloader32_v1.dll | 298112 | bd792e6c0183bacaff6f2be84c17b818c165fa4d2eb232f1aa072353ebc66598 |
| mousemux-v3-reloader32_v2.dll | 530048 | 87d4ae57f23b43ff0c72171c90106b1fc180f2585d9c27566aa530440a112059 |
| mousemux-v3-unloader32_v1.dll | 298112 | b24e35153618d91a851315b5fdbd6364837f7fed4c68132c9312824a7eeed791 |
| mousemux-v3-unloader32_v2.dll | 530048 | beaddee2a2499528fb17fde78aaa3e370af79c495f272c15197806b3fccc6514 |
| mousemux-v3-winhooks32.dll | 380032 | a04f54c48b738d53979410daaf0b95f3955eb7910d48f3c8c3cc2d2c0c82a52e |
| symsrv.dll | 134264 | e1a7e32abd7cde0412702242d5979c22eb2f8f86e7df3694eac2481bf29c0fdb |

`dbghelp`, `exchndl`, `mgwhelp`, and `symsrv` supply crash handling, stack walking, and symbols. Their exports include minidump/symbol operations and `ExcHndlInit`/`ExcHndlSetLogFileNameA`; they do not expose participant input.

## REA findings

The global REA 4.0.1 installation lacked the needed Windows x86 path. Local REA 6.3.0 and Ghidra 12.1.4 successfully analyzed `winhooks32` (158 procedures, 1791 strings) and decompiled all eight exports. PE inventory and LLVM disassembly provide independent evidence.

The complete sequential REA batch finished all nine requested DLLs in 627.87 seconds, with zero tool errors and 31/31 selected exported-function requests succeeding. These are overview/procedure analyses, not a claim that every recovered function was understood or tested dynamically.

| DLL | Procedures found | Strings found |
| --- | ---: | ---: |
| dbghelp | 4881 | 2186 |
| exchndl | 161 | 205 |
| mgwhelp | 729 | 1088 |
| reloader32_v1 | 878 | 1407 |
| reloader32_v2 | 372 | 2535 |
| unloader32_v1 | 878 | 1407 |
| unloader32_v2 | 372 | 2535 |
| winhooks32 | 158 | 1791 |
| symsrv | 669 | 430 |

The local `rea-final-coverage.json` records digest-linked coverage; `rea-batch.jsonl` contains the raw responses. A separate focused pass succeeded on all eight winhooks exports; two exploratory internal-address lookups in that separate pass failed because REA had no procedure at those addresses. The main nine-file batch had no such failures. All REA sessions were closed after completion.

The exports are `hook_create`, `hook_start`, `hook_stop`, `hook_flag`, `hook_ping`, `hook_pong`, `hook_range`, and `version`. A table at VA `0x1000d008` selects Windows hook IDs 14, 2, and 13. `hook_create` at `0x10001720` selects a slot; the worker reached from `hook_start` installs the hook and pumps Windows messages. Ping/stop use messages `0x8002`/`0x8001`. These are internal global-hook lifecycle operations, not a user/cursor SDK. Decompiled parameter types are inferred and are not a verified ABI.

The v1 reloader/unloader pair each has 19 exports and Deviare/NktHookLib identifiers. The v2 pair each has 30 exports, MinHook identifiers, process-injection imports, named-pipe strings, and a global shared mapping name. This establishes likely hook/injection infrastructure. It does **not** establish the shared-memory layout or pipe payload contract. Names containing `64` do not change the x86 architecture of the DLL containing them.

Within each v1/v2 pair, the reloader and unloader `.text` section hashes match exactly even though their full-file hashes differ. They are related infrastructure variants rather than nine distinct input engines.

A 64-bit Node/Ableton process cannot directly load these x86 DLLs. Recreating the undocumented injection path would also make this integration depend on internal state that has not been recovered. CoLaB therefore consumes the supported application-level input stream.

## Verified integration contract

Sources: [official Web SDK](https://www.mousemux.com/pages/sdk-web/) and [V3 manual](https://www.mousemux.com/pages/manual/), cross-checked against the installed `bin64/mousemux-v3-main.exe`, SHA-256 `74eef230e09c262088a9dfcb3855e671c090933abbdc43d51ee9e5c4d4c04565`.

Messages are flat JSON over the local WebSocket SDK, normally port 41001. Raw pointer notifications carry `hwid,x,y`; button events add transition flags, and wheels add signed delta plus optional `horizontal:true`. Coordinates are physical screen pixels. The SDK's JavaScript-enriched `userId` is **not** present in raw pointer messages: CoLaB maps `hwid` through `user.list.notify.M2A`, whose users contain `id,name,devices`; pointer devices use type `pointer`, not `mouse`.

The client sends `client.login.request.A2M` metadata, requests the user list, and answers `server.ping.notify.M2A` with `client.pong.request.A2M`. Acknowledgements echo the original request type and include `ok` and optional `error`. Login success is required before control is accepted. Shutdown/disposal ends the relevant input state; SDK timeout is terminal and is not circumvented by reconnecting.

Evidence anchors in the installed x64 main executable (image base `0x140000000`): dispatch RVA `0x53a40`, response builder `0x5ce40`, user-list builder `0x568c0`–`0x57356`, changed-event emitter `0x5c620`–`0x5c6dc`; motion/button/ping format strings at VAs `0x1401b39c3`, `0x1401b3a03`, and `0x1401b39a1`. Addresses describe this exact build only; runtime code uses no offsets.

## Implementation scope

Original adapter: `multimouse/server/mousemux-input.js`. It feeds the existing Jam core's wire-1 parser. The necessary pre-existing MultiMouse panel, interaction core, OSC transport, and unit tests are included so a fresh clone is runnable. Other untracked CoLaB experiments are not required.

This implements independent pointer users in the CoLaB panel, not general Windows input virtualization or arbitrary network desktop control. No proprietary binaries, raw disassembly, or decompiled implementation are distributed. Local protocol fixtures verify the integration; live physical-device and Ableton behavior require the enabled SDK and a calibrated canvas rectangle.
