import { describeError } from './database.service';

describe('describeError', () => {
  it('prefixes the errno code onto the message', () => {
    const error = Object.assign(new Error('connect failed'), {
      code: 'ECONNREFUSED',
    });

    expect(describeError(error)).toBe('ECONNREFUSED: connect failed');
  });

  it('unwraps the AggregateError pg throws when no address connects', () => {
    // pg surfaces this with an empty top-level message, which is useless in a
    // health payload unless the inner reasons are pulled out.
    const aggregate = new AggregateError(
      [
        Object.assign(new Error('connect ECONNREFUSED ::1:5999'), {
          code: 'ECONNREFUSED',
        }),
        Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5999'), {
          code: 'ECONNREFUSED',
        }),
      ],
      '',
    );

    expect(describeError(aggregate)).toBe(
      'ECONNREFUSED: connect ECONNREFUSED ::1:5999; ' +
        'ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:5999',
    );
  });

  it('falls back to the code, then the name, for a message-less error', () => {
    expect(describeError(Object.assign(new Error(''), { code: 'ENOTFOUND' })))
      .toBe('ENOTFOUND');
    expect(describeError(new Error(''))).toBe('Error');
  });

  it('stringifies non-errors', () => {
    expect(describeError('boom')).toBe('boom');
  });
});
