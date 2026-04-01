/**
 * Creates a minimal Ableton .als project with CoLanew.amxd pre-loaded.
 * .als files are gzipped XML.
 */
var zlib = require('zlib');
var fs = require('fs');
var path = require('path');

// Minimal Ableton Live Set XML with one MIDI track containing a Max for Live device
// The device reference points to CoLanew.amxd
var xml = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0.1" SchemaChangeCount="3" Creator="coLaB" Revision="">
  <LiveSet>
    <NextPointeeId Value="20000" />
    <OverwriteProtectionNumber Value="2819" />
    <LomId Value="0" />
    <LomIdView Value="0" />
    <MasterTrack>
      <LomId Value="0" />
      <LomIdView Value="0" />
      <Name>
        <EffectiveName Value="Master" />
        <UserName Value="" />
        <Annotation Value="" />
        <MemorizedFirstClipName Value="" />
      </Name>
      <DeviceChain>
        <Mixer>
          <LomId Value="0" />
          <LomIdView Value="0" />
          <On>
            <LomId Value="0" />
            <Manual Value="true" />
          </On>
          <Volume>
            <LomId Value="0" />
            <Manual Value="0.794328" />
          </Volume>
          <Tempo>
            <LomId Value="0" />
            <Manual Value="120" />
          </Tempo>
        </Mixer>
      </DeviceChain>
    </MasterTrack>
    <Tracks>
      <MidiTrack Id="1">
        <LomId Value="0" />
        <LomIdView Value="0" />
        <Name>
          <EffectiveName Value="coLaB Sync" />
          <UserName Value="coLaB Sync" />
          <Annotation Value="" />
          <MemorizedFirstClipName Value="" />
        </Name>
        <Color Value="26" />
        <DeviceChain>
          <Mixer>
            <LomId Value="0" />
            <LomIdView Value="0" />
            <On>
              <LomId Value="0" />
              <Manual Value="true" />
            </On>
            <Volume>
              <LomId Value="0" />
              <Manual Value="0.794328" />
            </Volume>
            <Pan>
              <LomId Value="0" />
              <Manual Value="0" />
            </Pan>
            <SoloSink Value="false" />
            <Mute Value="false" />
            <Solo Value="false" />
          </Mixer>
          <Devices>
            <MaxForLiveInstrumentDevice Id="0">
              <LomId Value="0" />
              <LomIdView Value="0" />
              <On>
                <LomId Value="0" />
                <Manual Value="true" />
              </On>
              <Frozen Value="false" />
              <DeviceSourceContext Value="0" />
              <LastPresetRef>
                <FileRef>
                  <RelativePathType Value="5" />
                  <RelativePath Value="../../../colab/CoLanew.amxd" />
                  <Path Value="C:/Users/4382/colab/CoLanew.amxd" />
                  <Type Value="1" />
                  <LivePackName Value="" />
                  <LivePackId Value="" />
                </FileRef>
              </LastPresetRef>
              <LockedScripts />
              <IsFolded Value="false" />
              <ShouldShowPresetName Value="true" />
              <UserName Value="CoLanew" />
              <Annotation Value="" />
              <KeepMaxDeviceOpen Value="true" />
            </MaxForLiveInstrumentDevice>
          </Devices>
        </DeviceChain>
        <ClipSlotList />
      </MidiTrack>
    </Tracks>
    <Transport>
      <PhaseNudgeTempo>
        <LomId Value="0" />
        <Manual Value="120" />
      </PhaseNudgeTempo>
      <IsPlaying Value="false" />
    </Transport>
    <ViewData Value="{}" />
    <Annotation Value="" />
    <SongMasterValues />
  </LiveSet>
</Ableton>`;

// Gzip it
var gzipped = zlib.gzipSync(Buffer.from(xml, 'utf8'));

var outPath = path.join(process.env.USERPROFILE, 'colab-sync-project.als');
fs.writeFileSync(outPath, gzipped);
console.log('Created', outPath, '(' + gzipped.length + ' bytes)');
console.log('This .als has one MIDI track with CoLanew.amxd pre-loaded');
