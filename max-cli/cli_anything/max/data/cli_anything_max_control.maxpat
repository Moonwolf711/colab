{
    "patcher" : {
        "fileversion" : 1,
        "appversion" : {
            "major" : 9,
            "minor" : 0,
            "revision" : 13,
            "architecture" : "x64",
            "modernui" : 1
        },
        "classnamespace" : "box",
        "rect" : [100.0, 100.0, 720.0, 520.0],
        "openrect" : [100.0, 100.0, 720.0, 520.0],
        "default_fontsize" : 12.0,
        "default_fontname" : "Arial",
        "gridsize" : [8.0, 8.0],
        "boxanimatetime" : 0,
        "title" : "cli_anything_max_control",
        "boxes" : [
            {
                "box" : {
                    "id" : "obj-1",
                    "maxclass" : "newobj",
                    "text" : "loadbang",
                    "patching_rect" : [40.0, 30.0, 68.0, 22.0],
                    "numinlets" : 1,
                    "numoutlets" : 1,
                    "outlettype" : ["bang"]
                }
            },
            {
                "box" : {
                    "id" : "obj-2",
                    "maxclass" : "message",
                    "text" : "; dsp set 1",
                    "patching_rect" : [120.0, 30.0, 90.0, 22.0],
                    "numinlets" : 2,
                    "numoutlets" : 1,
                    "outlettype" : [""]
                }
            },
            {
                "box" : {
                    "id" : "obj-3",
                    "maxclass" : "newobj",
                    "text" : "udpreceive 8002",
                    "patching_rect" : [40.0, 80.0, 110.0, 22.0],
                    "numinlets" : 0,
                    "numoutlets" : 1,
                    "outlettype" : ["anything"]
                }
            },
            {
                "box" : {
                    "id" : "obj-4",
                    "maxclass" : "newobj",
                    "text" : "js cli_anything_max_dispatcher.js @autowatch 1",
                    "patching_rect" : [40.0, 140.0, 330.0, 22.0],
                    "numinlets" : 1,
                    "numoutlets" : 4,
                    "outlettype" : ["", "", "", ""]
                }
            },
            {
                "box" : {
                    "id" : "obj-5",
                    "maxclass" : "newobj",
                    "text" : "udpsend 127.0.0.1 8003",
                    "patching_rect" : [40.0, 460.0, 160.0, 22.0],
                    "numinlets" : 1,
                    "numoutlets" : 0
                }
            },
            {
                "box" : {
                    "id" : "obj-6",
                    "maxclass" : "newobj",
                    "text" : "*~ 0.",
                    "patching_rect" : [420.0, 240.0, 50.0, 22.0],
                    "numinlets" : 2,
                    "numoutlets" : 1,
                    "outlettype" : ["signal"]
                }
            },
            {
                "box" : {
                    "id" : "obj-7",
                    "maxclass" : "newobj",
                    "text" : "sfrecord~ 1",
                    "patching_rect" : [420.0, 300.0, 90.0, 22.0],
                    "numinlets" : 2,
                    "numoutlets" : 0
                }
            },
            {
                "box" : {
                    "id" : "obj-8",
                    "maxclass" : "newobj",
                    "text" : "cycle~ 440",
                    "patching_rect" : [420.0, 180.0, 80.0, 22.0],
                    "numinlets" : 2,
                    "numoutlets" : 1,
                    "outlettype" : ["signal"]
                }
            },
            {
                "box" : {
                    "id" : "obj-9",
                    "maxclass" : "newobj",
                    "text" : "dac~",
                    "patching_rect" : [540.0, 360.0, 40.0, 22.0],
                    "numinlets" : 2,
                    "numoutlets" : 0
                }
            },
            {
                "box" : {
                    "id" : "obj-10",
                    "maxclass" : "comment",
                    "text" : "cli-anything-max control patch — listens on UDP 8002, replies to 8003",
                    "patching_rect" : [40.0, 5.0, 520.0, 20.0],
                    "numinlets" : 1,
                    "numoutlets" : 0
                }
            }
        ],
        "lines" : [
            {"patchline" : {"source" : ["obj-1", 0], "destination" : ["obj-2", 0]}},
            {"patchline" : {"source" : ["obj-3", 0], "destination" : ["obj-4", 0]}},
            {"patchline" : {"source" : ["obj-4", 0], "destination" : ["obj-5", 0]}},
            {"patchline" : {"source" : ["obj-4", 1], "destination" : ["obj-6", 1]}},
            {"patchline" : {"source" : ["obj-4", 2], "destination" : ["obj-7", 0]}},
            {"patchline" : {"source" : ["obj-8", 0], "destination" : ["obj-6", 0]}},
            {"patchline" : {"source" : ["obj-6", 0], "destination" : ["obj-7", 1]}},
            {"patchline" : {"source" : ["obj-6", 0], "destination" : ["obj-9", 0]}},
            {"patchline" : {"source" : ["obj-6", 0], "destination" : ["obj-9", 1]}}
        ]
    }
}
