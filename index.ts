const dotenv = require('dotenv');
import signale from 'signale';
import { ActivityType } from 'discord-api-types';
import { Client, Constants, Intents, Presence, TextChannel, VoiceState, VoiceChannel } from 'discord.js';

// notify on start
signale.start('starting up...');

// Setup - grab env vars and create client
dotenv.config();
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const ANNOUNCE_CHANNEL_ID = process.env.ANNOUNCE_CHANNEL_ID;

// client and variable
const client = new Client({
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.DIRECT_MESSAGES,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.GUILD_VOICE_STATES,
        Intents.FLAGS.GUILD_PRESENCES,
    ],
});
let logChannel: TextChannel | undefined;
let announceChannel: TextChannel | undefined;

// handles ctrl-c
async function cleanupAndExit() {
    // Change status then exit
    try {
        signale.complete('Exiting...');
        if (logChannel) {
            await logChannel?.send('Shutting down');
        }
        
        client?.user?.setPresence({ status: 'invisible', afk: true });
    } catch (e) {
        signale.error('Error on sigint:', e);
    }
    // always exit
    process.exit();
}
process.on('SIGINT', cleanupAndExit);
process.on('SIGKILL', cleanupAndExit);

// Run on boot
client.once(Constants.Events.CLIENT_READY, async () => {
    client?.user?.setPresence({ activities: [{ name: 'for changes', type: ActivityType.Watching }], status: 'online' });
    signale.success('Ready!');
    if (LOG_CHANNEL_ID) {
        logChannel = await client.channels.fetch(LOG_CHANNEL_ID) as TextChannel;
        await logChannel?.send('Cyder Ready');
    }
    if (ANNOUNCE_CHANNEL_ID) {
        announceChannel = await client.channels.fetch(ANNOUNCE_CHANNEL_ID) as TextChannel;
    }
});

// TODO: Can I find out if people are screen sharing?
// client.on(Constants.Events.PRESENCE_UPDATE, (oldPresence, newPresence: Presence) => {
//     console.log('PRESENCE UPDATE', newPresence.activities)
// })

// On voice change we'll do stuff
client.on(Constants.Events.VOICE_STATE_UPDATE, async (oldState: VoiceState, newState: VoiceState) => {
    // Grab the channels
    const oldVoiceChannel = oldState.channel as VoiceChannel;
    const currentVoiceChannel = newState.channel as VoiceChannel;

    // If no one is in the voice channel we're done!
    if (!currentVoiceChannel) {
        if (oldVoiceChannel && oldVoiceChannel.members.size == 0) {
            // TODO: This incorrectly triggered when the streamer left and 2 others were still in the call.
            signale.complete(`Everyone has left voice channel: ${oldVoiceChannel?.name}`);
            if (logChannel) {
                await logChannel.send(`Everyone has left voice channel: ${oldVoiceChannel?.name}`)
            }
            const colonPosition = oldVoiceChannel?.name.indexOf(':');
            if (colonPosition >= 0) {
                const newChannelName = `${oldVoiceChannel?.name.substring(0, colonPosition)}: TBD`;
                signale.info(`New Channel name is: ${newChannelName}`);
    
                try {
                    const vc = (await oldVoiceChannel.fetch(true)) as VoiceChannel;
                    signale.log('Renaming channel...');
                    const vcPostUpdate = await vc.setName(newChannelName);
                    signale.success(`New name set: ${vcPostUpdate?.name}`);
                } catch (e) {
                    signale.error('error', e);
                }
            }
        }
        return;
    }

    // If there's currently members, let's check what they're playing
    const members = [];
    const activityOngoing = new Set();
    for (const [id, member] of currentVoiceChannel?.members) {
        // only include streaming stuff, no custom status, and non-empty names
        const currentActivities = member?.presence?.activities?.filter(
            (activity) =>
                ['PLAYING', 'STREAMING', 'COMPETING'].includes(activity.type) &&
                activity.id !== 'custom' &&
                activity.name.trim().length > 0
        );
        signale.note('Current activities for ', member.nickname || member.displayName, ': ',currentActivities);

        // Put all relevant activity names in a Set
        if (Array.isArray(currentActivities)) {
            for (const activity of currentActivities) {
                activityOngoing.add(activity?.name);
            }
        }
        // grab the name of the member
        members.push(member?.nickname || member?.user?.username);
    }

    // List members and/or activities
    signale.info(
        `There are ${members.length} people hanging out in ${currentVoiceChannel?.name}. List: ${members.join(',')}`
    );
    if (oldState.streaming && newState.streaming == false) {
        // stopped streaming
        signale.pause('No one is streaming any more.');
        if (logChannel) {
            await logChannel.send(`Stream ended!`)
        }
    } else if (newState.streaming && oldState.streaming) {
        // Continued streaming
        const beingPlayed = Array.from(activityOngoing);
        const colonPosition = currentVoiceChannel?.name.indexOf(':');
        signale.log(
            'Still streaming! ',
            beingPlayed.join(','),
            ' are being played',
            `New Channel name would be ${currentVoiceChannel?.name.substring(0, colonPosition)}: ${beingPlayed.join(
                ' & '
            )}`
        );
    } else if (newState.streaming) {
        // started streaming
        const beingPlayed = Array.from(activityOngoing);
        if (beingPlayed.length > 0){
            const colonPosition = currentVoiceChannel?.name.indexOf(':');
            const newChannelName = `${currentVoiceChannel?.name.substring(0, colonPosition)}: ${beingPlayed.join(' & ')}`;
            signale.start(beingPlayed.join(','), ' is/are being played');
            const result = await currentVoiceChannel?.setName(newChannelName, `Someone is streaming ${beingPlayed.join(' & ')}`);
            signale.log('Channel name updated', result.name);
    
            if (logChannel) {
                await logChannel.send(`${members.length} people are hanging out and playing ${beingPlayed.join(',')}`)
            }
            if (announceChannel) {
                await announceChannel.send(`${members.length} people are hanging out and playing: ${beingPlayed.join(',')}`)
            }
        } else {
            if (logChannel) {
                await logChannel.send(`${members.length} people are hanging out and might be screensharing`)
            }
            
            // TODO: Log all activities to figure out what's going on.
            // signale.debug()
            signale.note('People must be screensharing?')
        }
    }
});

// start up everything!
client.login(DISCORD_TOKEN);
