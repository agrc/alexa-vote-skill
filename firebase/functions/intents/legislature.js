'use strict';

const { BasicCard, Button, Image, Suggestions, Table } = require('actions-on-google');
const { context, lifespan } = require('../config/config');
const agrc = require('../services/agrc');
const contextHelper = require('../context');
const location = require('./location');
const le = require('../services/le');
const text = require('../config/text');

exports.legislatureIntents = {
  'legislature.mine': (conv) => {
    console.log('INTENT: who represents me');

    conv.user.storage.intent = 'legislature.mine';

    if (contextHelper.getLocation(conv) || contextHelper.getDistricts(conv)) {
      return findLegislators(conv);
    }

    return location.requestLocation(conv, 'To find your elected officials');
  },
  'legislature.details': (conv, params) => {
    console.log('INTENT: specific legislator details');

    console.log(params);

    conv.user.storage.branch = params.Branch;
    conv.user.storage.intent = 'legislator.specific';

    if (contextHelper.getLocation(conv) || contextHelper.getDistricts(conv) || contextHelper.getOfficials(conv)) {
      return findSpecificLegislator(conv);
    }

    return location.requestLocation(conv, 'To find details about your elected official');
  }
};

exports.countIntents = {
  'legislature.count': (conv) => {
    const all = le.search().legislators;
    let sens = 0;
    let reps = 0;

    all.forEach((legislator) => {
      if (legislator.house.toLowerCase() === 'h') {
        reps += 1;
      } else {
        sens += 1;
      }
    });

    conv.ask(text.COUNT
      .replace('{{total}}', reps + sens)
      .replace('{{sens}}', sens)
      .replace('{{reps}}', reps)
    );

    conv.ask(new Table({
      title: `Legislators: ${reps + sens}`,
      columns: [{
        header: 'Senators',
        align: 'CENTER'
      }, {
        header: 'Representatives',
        align: 'CENTER'
      }],
      rows: [[sens.toString(), reps.toString()]]
    }));

    return conv.ask(new Suggestions([
      'How many democrats',
      'How many republicans'
    ]));
  },
  'legislature.statistics': (conv) => {
    const all = le.search().legislators;
    let dems = 0;
    let reps = 0;

    all.forEach((legislator) => {
      if (legislator.party.toLowerCase() === 'r') {
        reps += 1;
      } else {
        dems += 1;
      }
    });

    const total = reps + dems;

    conv.ask(text.PARTY_STATS
      .replace('{{dems}}', dems)
      .replace('{{reps}}', reps)
      .replace('{{dem_percent}}', ((dems / total) * 100).toFixed(1))
      .replace('{{rep_percent}}', ((reps / total) * 100).toFixed(1))
    );

    return conv.ask(new BasicCard({
      title: 'Party Statistics',
      text: '**Democrats**: ' + dems.toString() +
        '\r\n\r\n**Republicans**: ' + reps.toString()
    }));
  }
};

const findLegislators = (conv) => {
  console.log('legislature.findLegislators');

  return new Promise((resolve, reject) => {
    // get districts
    console.log('1: trying for districts')
    const districts = contextHelper.getDistricts(conv);

    // if null get location, then get districts
    if (!districts) {
      console.log('no districts');

      return getDistricts(conv)
        .then((result) => resolve(returnLegislators(conv, result)))
        .catch(reject);
    }

    console.log('district in contexts returning');
    return resolve(returnLegislators(conv, districts));
  });
};

const findSpecificLegislator = (conv) => {
  console.log('legislature.findSpecificLegislator');

  const returnLegislator = (conv, officials) => {
    let data;
    const { representative, senator, official } = officials;

    if (official === 'house') {
      data = representative;
      data.branch = 'representative';
    } else if (official === 'senate') {
      data = senator;
      data.branch = 'senator';
    } else {
      return conv.ask('Which branch are you interested in?');
    }

    conv.ask(text.DETAILS
      .replace('{{official}}', data.formatName)
      .replace('{{profession}}', data.profession)
      .replace('{{education}}', data.education)
      .replace('{{type}}', data.branch)
      .replace('{{serviceStart}}', data.serviceStart)
    );

    return conv.ask(new BasicCard({
      image: new Image({
        url: data.image,
        alt: data.formatName
      }),
      title: data.formatName,
      subtitle: data.branch,
      text: `**District**: ${data.district}\r\n\r\n` +
        `**Counties**: ${data.counties}\r\n\r\n` +
        `**Profession**: ${data.profession}\r\n\r\n` +
        `**Education**: ${data.education}\r\n\r\n` +
        `**email**: ${data.email}\r\n\r\n` +
        `**cell**: ${data.cell}`,
      buttons: [
        new Button({
          title: 'Legislation',
          url: data.legislation
        })
      ]
    }));
  };

  return new Promise((resolve, reject) => {
    // get officials
    let officials = contextHelper.getOfficials(conv);
    // if null get location, then get officials
    if (!officials) {
      const districts = contextHelper.getDistricts(conv);

      if (!districts) {
        return getDistricts(conv)
          .then((result) => {
            officials = getSenatorRepFromDistrict(conv, result);

            if (!('official' in officials)) {
              console.log('missing official key');

              officials.official = conv.user.storage.branch;
              console.log(officials)
            }

            return resolve(returnLegislator(conv, officials));
          })
          .catch(reject);
      }

      officials = getSenatorRepFromDistrict(conv, districts);

      if (!('official' in officials)) {
        officials.official = conv.user.storage.branch;
      }

      return resolve(returnLegislator(conv, officials));
    }

    return resolve(returnLegislator(conv, officials));
  });
};

const deabbrivate = (partyAbbr) => {
  if (partyAbbr === 'D') {
    return 'democrat'
  }

  if (partyAbbr === 'R') {
    return 'republican'
  }

  return partyAbbr;
};

const returnLegislators = (conv, districts) => {
  console.log('legislature.returnLegislators');
  console.log(districts);

  const { house, senate } = districts;

  conv.user.storage.senateDistrict = senate;
  conv.user.storage.houseDistrict = house ;

  const { senator, representative } = getSenatorRepFromDistrict(conv, districts);

  conv.ask(text.LEGISLATOR
    .replace('{{sen_party}}', deabbrivate(senator.party))
    .replace('{{sen}}', senator.formatName)
    .replace('{{rep}}', representative.formatName)
    .replace('{{rep_party}}', deabbrivate(representative.party))
  );

  conv.ask(new Table({
    title: 'Your Legislators',
    subtitle: `Senate District ${senate} House District ${house}`,
    columns: [{
      header: 'Representative',
      align: 'CENTER'
    }, {
      header: 'Senator',
      align: 'CENTER'
    }],
    rows: [[representative.formatName, senator.formatName]]
  }));

  return conv.ask(new Suggestions([
    'Representative details',
    'Senator details'
  ]));
};

const getSenatorRepFromDistrict = (conv, districts) => {
  console.log('legislature.getSenatorRepFromDistrict');
  console.log(districts);

  const { house, senate } = districts;
  // query le service for legislators
  const legislators = le.search().legislators;

  const senator = legislators.filter((item) => item.house === 'S' && item.district === senate.toString())[0];
  const representative = legislators.filter((item) => item.house === 'H' && item.district === house.toString())[0];

  conv.user.storage.senator = senator;
  conv.user.storage.representative = representative;

  return { senator, representative };
};

const getDistricts = (conv) => {
  console.log('legislature.getDistricts');

  const location = contextHelper.getLocation(conv);

  if (!location) {
    return location.requestLocation(conv, 'To find your legislator');
  }

  const options = {
    spatialReference: 4326,
    geometry: `point:[${location.longitude},${location.latitude}]`
  };

  return agrc.search('sgid10.political.officialslookup', ['repdist', 'sendist'], options)
    .then(result => {
      if (result.message) {
        return { error: result.message };
      }

      const senate = result.senate;
      const house = result.house

      conv.user.storage.senateDistrict = senate;
      conv.user.storage.houseDistrict = house;

      console.log(`returning senate: ${senate}. house: ${house}`);

      return {
        senate,
        house
      };
    });
};


exports.findLegislators = findLegislators;

exports.findSpecificLegislator = findSpecificLegislator;
