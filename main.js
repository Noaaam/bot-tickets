require('dotenv').config();
const { Client } = require('discord.js');
const client = new Client({ partials: ['MESSAGE', 'REACTION'] });
const db = require('./database');
const Ticket = require('./models/Ticket');
const TicketConfig = require('./models/TicketConfig');

client.once('ready', () => {
    console.log('✅ Synchronisation effectuée avec Discord');
    client.user.setActivity('💰 | Transfer Money', { type: 'WATCHING' });
    db.authenticate()
      .then(() => {
          console.log('✅ Synchronisation effectuée avec la DB');
          Ticket.init(db);
          TicketConfig.init(db);
          Ticket.sync();
          TicketConfig.sync();
      }).catch((err) => console.log(err));    
});

client.on('message', async (message) => {

    if (message.author.bot || message.channel.type === 'dm') return;

    if (message.content.toLowerCase() === '?setup' && message.guild.ownerID === message.author.id) {
        try {
          const filter = (m) => m.author.id === message.author.id;
          message.channel.send('⌛ | Veuillez saisir l\'identifiant du message pour y assigner la réaction');
          const msgId = (await message.channel.awaitMessages(filter, { max: 1 })).first().content;
          const fetchMsg = await message.channel.messages.fetch(msgId);
          message.channel.send('⌛ | Veuillez saisir l\'identifiant de la categorie pour y assigner les salons de tickets');
          const categoryId = (await message.channel.awaitMessages(filter, { max: 1 })).first().content;
          const categoryChannel = client.channels.cache.get(categoryId);
          message.channel.send('⌛ | Veuillez saisir tous les rôles ayant accès aux tickets');
          const roles = (await message.channel.awaitMessages(filter, { max: 1 })).first().content.split(/,\s*/);
          if (fetchMsg && categoryChannel) {
              for (const roleId of roles)
                  if (!message.guild.roles.cache.get(roleId)) throw new Error('❌ | Ce role n\'existe pas !');
 
              const ticketConfig = await TicketConfig.create({
                  messageId: msgId,
                  guildId: message.guild.id,
                  roles: JSON.stringify(roles),
                  parentId: categoryChannel.id
              })
              console.log(ticketConfig);
              message.channel.send('✅ | La configuration a été sauvegardée dans la base de données');
              await fetchMsg.react('📩');
            } else throw new Error('❌ | Champs invalide');

        } catch (err) {
          console.log(err);     
        }
    }
});

client.on('messageReactionAdd', async(reaction,user) => {
    if (user.bot) return;
    if (reaction.emoji.name === '📩') {
        const ticketConfig = await TicketConfig.findOne({ where: { messageId: reaction.message.id }});
        if (ticketConfig) {
          const findTicket = await Ticket.findOne({ where: { authorId: user.id, resolved: false }});
          if (findTicket) user.send('❌ | Vous avez déjà un ticket !');
          else {
              console.log('🕐 Création du ticket...');
              try {
                const roleIdsString = ticketConfig.getDataValue('roles');
                console.log(roleIdsString);
                const roleIds = JSON.parse(roleIdsString);
                const permissions = roleIds.map((id) => ({ allow: 'VIEW_CHANNEL', id }));
                const channel = await reaction.message.guild.channels.create('ticket', {
                    parent: ticketConfig.getDataValue('parentId'),
                    permissionOverwrites: [
                        { deny: 'VIEW_CHANNEL', id: reaction.message.guild.id },
                        { allow: 'VIEW_CHANNEL', id: user.id },
                        ...permissions
                    ]
                });

                const msg = await channel.send('Vous avez la possibilité de clôturer le ticket en réagissant à l\'émoji suivant 🔒');
                await msg.react('🔒');

                console.log(msg.id);
                const ticket = await Ticket.create({
                    authorId: user.id,
                    channelId: channel.id,
                    guildId: reaction.message.guild.id,
                    resolved: false,
                    closedMessageId: msg.id
                });

                const ticketId = String(ticket.getDataValue('ticketId')).padStart(4, 0);
                await channel.edit({ name: `ticket-${ticketId}`});

              } catch (err) {
                console.log(err);
              }
          }
        } else {
            console.log('❌ | La configuration n\'a pas été trouvée');
        }
    } else if (reaction.emoji.name === '🔒') {
      const ticket = await Ticket.findOne({ where: { channelId: reaction.message.channel.id }});
      if (ticket) {
          const closedMessageId = ticket.getDataValue('closedMessageId');
          if (reaction.message.id === closedMessageId) {
             await reaction.message.channel.updateOverwrite(ticket.getDataValue('authorId'), {
                  VIEW_CHANNEL: false
              }).catch ((err) => console.log(err));
              ticket.resolved = true;
              await ticket.save();
          }
      }
    }
});

client.login(process.env.BOT_TOKEN);

