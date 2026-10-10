# One transmission at a time

Planning only. This note does not change the client, the API, or LiveKit. It compares two ways a community can stop people talking over each other, and recommends which one to build first.

## Summary

Radio Net is listen-many, talk-one. You can hear every channel you have tuned, and you transmit on one of them. Nothing stops a second person on that same channel from transmitting at the same time. LiveKit mixes both microphones, so the channel becomes a conference instead of a radio net.

Tobias wants that choice on the community, and maybe on a single channel:

- **Open.** Today’s mix. Anyone who may talk can talk, and overlapping voices play together.
- **Floor.** Half-duplex, like a real radio. One person holds the channel. Everyone else hears a “channel busy” tone and waits.
- **Queue.** Like TACCOM’s MQP. Overlapping transmissions are recorded and played back one after another, with a max length (for example 10 seconds).

**Recommendation.** Build floor first, and leave the default on open so existing communities do not change. Store the mode as `open | floor | queue` now, and do not build the queue until a group actually wants delayed playback. The queue is a new media path. Floor is a mute decision on the path we already have.

## What the code does today

Each channel is one LiveKit room, `g{communityId}.ch{channelId}` (`roomNameFor` in `spike/server/src/store.ts`). `mintChannelGrants` in `spike/server/src/tokens.ts` gives everyone tuned `canSubscribe`, and gives `canPublish` for the microphone on every channel that person may talk on. That grant is what makes a transmit-channel switch instant: the mic track is already published, muted, and a key-down only unmutes it. `canPublishData` is false on those voice rooms. The client is what enforces “only one transmit channel”. The server only decides who is allowed to talk where.

`RoomEvent.ActiveSpeakersChanged` in `radioEngine.ts` fills the names on the channel. The local participant is filtered out there. The overlay adds the local callsign while that person is transmitting. The SFU mixes every unmuted publisher. There is no server mute of a second talker, and LiveKit has no floor object.

## The setting

Add `transmission: 'open' | 'floor' | 'queue'` on the community. Missing or unknown means `open`, so old `store.json` files keep today’s mix. Return it from `publicCommunity` (today that object is only `id`, `name`, `band`, `inviteCode`). Changing it requires the admin key, the same `x-admin-key` check as create and delete channel.

A per-channel override can come later: `channel.transmission` null means “use the community”. Command can be floor while a side channel stays open. The first build can be community-wide and still use this shape, so the admin control does not need a second migration when the override arrives.

## Floor control

One talker per channel. The next person does not talk until the holder releases. This matches a half-duplex net: you hear the channel is busy, and you wait.

### How to enforce it

Three approaches were considered. Only the first one actually keeps a second microphone off the mix.

**Server mute, with the existing publish grant.** The API keeps a floor holder per room. On key-down the client asks the API. If the floor is free, the API records that session as the holder and the client unmutes the track it already published. If someone else holds it, the API tells the client “busy” and the client does not unmute. The server is the authority: it calls LiveKit RoomService `mutePublishedTrack` on anyone publishing in that room who is not the holder. A modified client that unmutes anyway is muted again. Do not take `canPublish` away on each press. Minting a new token and renegotiating the track is the cost the current grant was designed to avoid, and it would clip the start of every transmission.

**A data-channel “busy” message.** Do not use this as the lock. Voice rooms have `canPublishData: false`. A data message is also a hint: the client can ignore it and keep the microphone unmuted. The SFU would still mix that audio.

**Buffering remote tracks in the client.** Do not use this for half-duplex. The SFU has already mixed both publishers before a listener’s client sees the tracks. Each listener would also be free to play them in a different order. Buffering only changes what one person hears. It does not stop the double-talk.

The client can still take a fast path. If `ActiveSpeakers` for that channel is already non-empty, play the busy tone immediately and skip the request. That can be wrong for a few tens of milliseconds (a speaker who just released, or a speaker this client has not heard yet), so the server answer wins. Be pessimistic about unmute: the microphone stays muted until the grant comes back, so two people who press together do not talk over each other for one round trip. Sydney is the API and the LiveKit host, so that wait is the client-to-Sydney round trip, on the order of a few tens of milliseconds, not a reconnect.

After release, keep the floor for a short hangover, about 200 ms, so the end of the word (and a roger beep, if that ships) is heard before the next person is granted. A new press from the same person during the hangover keeps the floor. Anyone else who presses during it hears busy.

### Latency

The winner’s voice still has normal LiveKit mouth-to-ear delay. Floor does not add a playback buffer. The only extra wait is the grant round trip before unmute, and the hangover before the next grant. The rejected person hears a local tone, so that cue is not waiting on a media path.

### Fairness

The first request that arrives while the floor is idle wins. There is no queue position. Holding the key early does not reserve a turn. After release, the next key-down races, and the server orders same-moment requests by arrival. The loser hears busy.

The floor must drop when the holder mutes, leaves the room, or disconnects. Otherwise a crashed client sits on the channel. A maximum transmit length (the server takes the floor back) is an open question below. Without it, one person can hold the net for as long as they hold the key.

### Several tuned channels

The floor is per LiveKit room, so it is per channel. Command being busy does not block Arty. You still transmit on one channel, so you cannot hold two floors. Listening to many channels stays as it is.

### Admin override

An admin (the same admin key, or a session the server has marked as admin) can take the floor: the server mutes the current holder and grants the admin. The person who was cut off stops transmitting; their button leaves the on-air state. Ranks beyond that single override — section leader above a member, for example — are not part of the first slice. The data model should not grow a priority integer until someone asks for it.

### What the player sees

- The talk button does not go on-air until the floor is granted. A rejected press never looks like a transmission.
- Busy is a local tone, different from the transmit-channel tone and from a roger beep. A short “Channel busy” line sits on that channel.
- Everyone else still sees the holder’s name, the way live speakers show today.
- The channel can carry a small “floor” mark so the net is obviously half-duplex.

Phone and helper push-to-talk key the computer’s microphone. They do not publish their own track. The floor check happens on that computer, once, when the mic is about to unmute.

## A true queue

Record the transmissions that overlap and play them back in order. A clip longer than the cap (10 seconds is the figure Tobias gave) is cut, and the sender is told.

### Approaches that do not fit

LiveKit Egress writes a file and is slow to start. It is the wrong tool for a 10-second clip that should play as soon as the channel is free.

Uploading the audio to the API stores someone else’s voice on the server, grows disk, and changes the privacy story (today voice goes to LiveKit while the key is held, and the API does not keep it). Do not do that.

Client-side buffering of remote tracks has the same problem as in the floor section: the mix has already happened, and two listeners can disagree.

### The approach that fits

Floor control is the playback lock: only one person publishes at a time. While the floor is busy, the sender records locally, up to 10 seconds. When the channel is free and this clip is next, the client plays that buffer into the same published microphone track. Listeners hear an ordinary LiveKit track. Nothing new is stored on the API.

The queue is FIFO per channel. Cap how many clips can be waiting, and keep at most one queued clip per person, so one sender cannot fill the net. A second press while a clip is waiting replaces that clip or is rejected; that choice is open below. If the sender closes the tab, their clip is gone. Reconstructing it would mean the server had kept the audio.

### Latency

This is not live. The delay is “until the channel is free, plus every clip in front of you”. One 10-second clip ahead means a 10-second wait. The screen has to say “Queued” while recording and “Recorded” while that clip plays, with how many are ahead. A busy tone is the wrong cue: the press was accepted.

### Fairness

FIFO is fairer than racing after each release. A long clip still blocks the net for its length, which is why the cap and the one-clip-per-person rule matter. Admin can flush the queue or play next, using the same preempt mute as floor.

### Several tuned channels

The queue is per channel, same as the floor. A Command clip does not delay Arty. You only record on the channel you are transmitting on.

## Effort

Floor is a small API module plus a client grant step: the community field and admin update, the holder table, RoomService mute, the busy tone, and the button staying off until granted. Tests are two publishers with the second forced muted, a disconnect releasing the floor, and an admin preempt. That is the size of a focused client audio change plus one server service. It is not a new media pipeline.

The queue is a new subsystem on top of that: a local capture buffer, a per-channel FIFO, playback into the already-published track, the “recorded” cues, the caps, and the rule that a disconnect drops the clip. It is several times the floor work, and it depends on the floor existing so that playback stays one publisher.

## Recommendation

Ship floor, default `open`. Name the stored value so `queue` can be added without a new setting. Do not start the queue in the same change. Groups that want a real radio net get it from the floor. Groups that want overlapping talk preserved, late and in order, can ask for the queue after the lock is in place.

## Open questions

1. Should the first slice include the per-channel override, or only the community setting?
2. Is there a maximum hold time before the server takes the floor back, and what is it?
3. For the queue: one waiting clip per person, or several? Does a second press replace the first?
4. Confirm a queued clip dies with the sender’s tab.
5. Is admin preempt enough, or do callsign ranks need to cut in?
6. Is the busy tone a new Sounds-menu cue with its own switch, or a fixed tone?
7. During the hangover, does the same holder’s new press keep the floor? This note assumes yes.

## Out of scope for the first build

No implementation in this change. No LiveKit config change. No revocation of `canPublish` on each press. No voice stored on the API. No priority ranks. No queue recorder.
