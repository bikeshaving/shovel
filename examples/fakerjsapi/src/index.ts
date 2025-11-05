import { faker, allFakers } from '@faker-js/faker';

const PORT = process.env.PORT || 3000;

const SUPPORTED_LOCALES = Object.keys(allFakers).filter(locale => locale !== 'base');

function parseParams(url: URL) {
  const id = url.searchParams.get('id');
  const locale = url.searchParams.get('locale') || 'en_US';

  // Validate locale
  if (!SUPPORTED_LOCALES.includes(locale)) {
    throw new Error(`Invalid locale: ${locale}. Supported locales: ${SUPPORTED_LOCALES.join(', ')}`);
  }

  // Validate and sanitize ID to prevent overflow issues
  let seedValue = 12345; // default seed
  if (id) {
    const parsedId = parseInt(id);
    if (isNaN(parsedId) || parsedId < 1 || parsedId > 2147483647) {
      throw new Error(`Invalid ID: ${id}. Must be between 1 and 2147483647`);
    }
    seedValue = parsedId;
  }

  // Use the correct faker instance for the locale
  const fakerInstance = allFakers[locale as keyof typeof allFakers];
  fakerInstance.seed(seedValue);

  return { id, locale, fakerInstance };
}

function generatePersonData(fakerInstance = faker) {
  return {
    firstName: fakerInstance.person.firstName(),
    lastName: fakerInstance.person.lastName(),
    fullName: fakerInstance.person.fullName(),
    gender: fakerInstance.person.gender(),
    prefix: fakerInstance.person.prefix(),
    suffix: fakerInstance.person.suffix(),
    jobTitle: fakerInstance.person.jobTitle(),
    jobDescriptor: fakerInstance.person.jobDescriptor(),
    jobArea: fakerInstance.person.jobArea(),
    jobType: fakerInstance.person.jobType()
  };
}

function generateLocationData(fakerInstance = faker) {
  return {
    country: fakerInstance.location.country(),
    countryCode: fakerInstance.location.countryCode(),
    state: fakerInstance.location.state(),
    city: fakerInstance.location.city(),
    streetAddress: fakerInstance.location.streetAddress(),
    street: fakerInstance.location.street(),
    buildingNumber: fakerInstance.location.buildingNumber(),
    zipCode: fakerInstance.location.zipCode(),
    latitude: fakerInstance.location.latitude(),
    longitude: fakerInstance.location.longitude(),
    timeZone: fakerInstance.location.timeZone()
  };
}

function generateCommerceData(fakerInstance = faker) {
  return {
    department: fakerInstance.commerce.department(),
    productName: fakerInstance.commerce.productName(),
    product: fakerInstance.commerce.product(),
    productMaterial: fakerInstance.commerce.productMaterial(),
    productDescription: fakerInstance.commerce.productDescription(),
    price: fakerInstance.commerce.price(),
    isbn: fakerInstance.commerce.isbn()
  };
}

function generateFinanceData(fakerInstance = faker) {
  return {
    accountName: fakerInstance.finance.accountName(),
    accountNumber: fakerInstance.finance.accountNumber(),
    routingNumber: fakerInstance.finance.routingNumber(),
    creditCardNumber: fakerInstance.finance.creditCardNumber(),
    creditCardCVV: fakerInstance.finance.creditCardCVV(),
    creditCardIssuer: fakerInstance.finance.creditCardIssuer(),
    bitcoinAddress: fakerInstance.finance.bitcoinAddress(),
    ethereumAddress: fakerInstance.finance.ethereumAddress(),
    iban: fakerInstance.finance.iban(),
    bic: fakerInstance.finance.bic(),
    transactionType: fakerInstance.finance.transactionType(),
    currencyCode: fakerInstance.finance.currencyCode(),
    currencyName: fakerInstance.finance.currencyName(),
    currencySymbol: fakerInstance.finance.currencySymbol(),
    amount: fakerInstance.finance.amount()
  };
}

function generateInternetData(fakerInstance = faker) {
  return {
    email: fakerInstance.internet.email(),
    userName: fakerInstance.internet.userName(),
    displayName: fakerInstance.internet.displayName(),
    protocol: fakerInstance.internet.protocol(),
    url: fakerInstance.internet.url(),
    domainName: fakerInstance.internet.domainName(),
    domainSuffix: fakerInstance.internet.domainSuffix(),
    domainWord: fakerInstance.internet.domainWord(),
    ip: fakerInstance.internet.ip(),
    ipv6: fakerInstance.internet.ipv6(),
    port: fakerInstance.internet.port(),
    userAgent: fakerInstance.internet.userAgent(),
    mac: fakerInstance.internet.mac(),
    password: fakerInstance.internet.password()
  };
}

function generateCompanyData(fakerInstance = faker) {
  return {
    name: fakerInstance.company.name(),
    catchPhrase: fakerInstance.company.catchPhrase(),
    bs: fakerInstance.company.buzzPhrase(),
    buzzAdjective: fakerInstance.company.buzzAdjective(),
    buzzNoun: fakerInstance.company.buzzNoun(),
    buzzVerb: fakerInstance.company.buzzVerb()
  };
}

function safeFakerCall(fn: Function, options: any = {}, fallback: any = 'N/A') {
  try {
    // Try with options first if options is not empty
    if (Object.keys(options).length > 0) {
      return fn(options);
    } else {
      return fn();
    }
  } catch (error) {
    try {
      // Fallback to no options if that fails
      return fn();
    } catch (error2) {
      // Return static fallback if both fail
      return fallback;
    }
  }
}

function generateLoremData(fakerInstance = faker, options: Record<string, any> = {}) {
  return {
    word: safeFakerCall(() => fakerInstance.lorem.word(options), {}, fakerInstance.lorem.word()),
    words: safeFakerCall(() => fakerInstance.lorem.words(options), {}, fakerInstance.lorem.words()),
    sentence: safeFakerCall(() => fakerInstance.lorem.sentence(options), {}, fakerInstance.lorem.sentence()),
    sentences: safeFakerCall(() => fakerInstance.lorem.sentences(options), {}, fakerInstance.lorem.sentences()),
    paragraph: safeFakerCall(() => fakerInstance.lorem.paragraph(options), {}, fakerInstance.lorem.paragraph()),
    paragraphs: safeFakerCall(() => fakerInstance.lorem.paragraphs(options), {}, fakerInstance.lorem.paragraphs()),
    text: fakerInstance.lorem.text(),
    lines: safeFakerCall(() => fakerInstance.lorem.lines(options), {}, fakerInstance.lorem.lines()),
    slug: safeFakerCall(() => fakerInstance.lorem.slug(options), {}, fakerInstance.lorem.slug())
  };
}

function generateDateData(fakerInstance = faker) {
  return {
    past: fakerInstance.date.past().toISOString(),
    future: fakerInstance.date.future().toISOString(),
    recent: fakerInstance.date.recent().toISOString(),
    soon: fakerInstance.date.soon().toISOString(),
    birthdate: fakerInstance.date.birthdate().toISOString(),
    anytime: fakerInstance.date.anytime().toISOString(),
    weekday: fakerInstance.date.weekday(),
    month: fakerInstance.date.month()
  };
}

function generatePhoneData(fakerInstance = faker) {
  return {
    number: fakerInstance.phone.number(),
    imei: fakerInstance.phone.imei()
  };
}

function generateImageData(fakerInstance = faker) {
  return {
    avatar: fakerInstance.image.avatar(),
    url: fakerInstance.image.url(),
    urlLoremFlickr: fakerInstance.image.urlLoremFlickr(),
    urlPicsumPhotos: fakerInstance.image.urlPicsumPhotos(),
    dataUri: fakerInstance.image.dataUri()
  };
}

function generateStringData(fakerInstance = faker) {
  return {
    uuid: fakerInstance.string.uuid(),
    nanoid: fakerInstance.string.nanoid(),
    binary: fakerInstance.string.binary(),
    octal: fakerInstance.string.octal(),
    hexadecimal: fakerInstance.string.hexadecimal(),
    numeric: fakerInstance.string.numeric(),
    alpha: fakerInstance.string.alpha(),
    alphanumeric: fakerInstance.string.alphanumeric(),
    sample: fakerInstance.string.sample()
  };
}

function generateNumberData(fakerInstance = faker) {
  return {
    int: fakerInstance.number.int({ min: 1, max: 1000 }), // Reasonable range
    float: fakerInstance.number.float({ min: 0, max: 100, fractionDigits: 2 }),
    binary: fakerInstance.number.binary(),
    octal: fakerInstance.number.octal(),
    hex: fakerInstance.number.hex()
  };
}

const moduleGenerators: Record<string, (fakerInstance: any, locale?: string) => any> = {
  person: generatePersonData,
  location: generateLocationData,
  commerce: generateCommerceData,
  finance: generateFinanceData,
  internet: generateInternetData,
  company: generateCompanyData,
  lorem: (fakerInstance) => generateLoremData(fakerInstance),
  date: generateDateData,
  phone: generatePhoneData,
  image: generateImageData,
  string: generateStringData,
  number: generateNumberData
};

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    };

    let locale, fakerInstance;
    try {
      ({ locale, fakerInstance } = parseParams(url));
    } catch (error) {
      return new Response(JSON.stringify({
        error: error instanceof Error ? error.message : 'Invalid parameters'
      }), {
        status: 400,
        headers
      });
    }

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers });
    }

    if (req.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers
      });
    }

    const pathParts = url.pathname.split('/').filter(Boolean);

    if (pathParts.length < 3 || pathParts[0] !== 'api' || pathParts[1] !== 'v1') {
      return new Response(JSON.stringify({
        error: 'Invalid API path. Use /api/v1/{module}',
        availableModules: Object.keys(moduleGenerators)
      }), {
        status: 404,
        headers
      });
    }

    const module = pathParts[2];
    const generator = moduleGenerators[module];

    if (!generator) {
      return new Response(JSON.stringify({
        error: `Module '${module}' not found`,
        availableModules: Object.keys(moduleGenerators)
      }), {
        status: 404,
        headers
      });
    }

    try {
      const data = generator(fakerInstance, locale);

      return new Response(JSON.stringify(data), { headers });

    } catch (error) {
      return new Response(JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 500,
        headers
      });
    }
  }
});

console.log(`🚀 Faker.js API running on http://localhost:${PORT}`);
console.log(`📋 Available modules:`);
Object.keys(moduleGenerators).forEach(module => {
  console.log(`  /api/v1/${module}`);
});
console.log(`💡 Add ?id=123&locale=de_DE for options`);
