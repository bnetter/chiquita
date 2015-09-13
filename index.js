'use strict';

var _ = require('lodash');
var async = require('async');
var Github = require('github');
var nodemailer = require('nodemailer');
var EmailTemplate = require('email-templates').EmailTemplate
var path = require('path');

var chiquita = {};
var github = new Github({
  version: '3.0.0'
});

/**
 * Chiquita default options
 */

chiquita.options = {
  repositories: [],
  users: {},
  transporter: {},
  credentials: {
    github: process.env.GITHUB_ACCESS_TOKEN
  },
  mail: {
    from: 'Chiquita',
    subject: 'You have pending work on Github'
  }
};

/**
 * Tasks to be run
 */

chiquita.tasks = {
  issue: [],
  pr: []
};

chiquita.task = function(type, action) {
  if (!_.contains(['issue', 'pull request'], type)) {
    throw new Error('Unrecognized task type `' + type + '` (can either be `issue` or `pull request`)');
  }
  if (type === 'pull request') {
    type = 'pr';
  }

  return chiquita.tasks[type].push(action);
}

chiquita.run = function() {
  var output = {};

  github.authenticate({
    type: 'oauth',
    token: this.options.credentials.github
  });

  async.each(this.options.repositories, function(repository, callback) {
    return async.waterfall([
      function(callback) {
        return github.search.issues({
          q: 'repo:' + repository + ' is:open'
        }, callback);
      },
      function(issues, callback) {
        var items = issues.items;

        _.forEach(items, function (issue) {
          issue.errors = chiquita._runOnIssue(issue);

          if (issue.errors.length) {
            var assignee = _.get(issue, 'assignee.login');

            if (_.isUndefined(output[assignee])) {
              output[assignee] = [];
            }

            output[assignee].push(issue);
          }
        });

        return callback();
      }
    ], callback);
  }, function(err) {
    if (err) {
      throw new Error(err);
    }

    return chiquita._sendReport(output);
  });
}

chiquita._runOnIssue = function(issue) {
  var type = (_.isUndefined(issue.pull_request)) ? ('issue') : ('pr');

  var errors = _.map(chiquita.tasks[type], function(func) {
    return func(issue);
  });

  return _.reject(errors, _.isEmpty);
}

chiquita._sendReport = function(output) {
  return async.each(_.keys(output), function(user, callback)  {
    return async.waterfall([
      function(callback) {
        var email = chiquita.options.users[user];

        if (_.isUndefined(email)) {
          return github.user.getFrom({
            user: user
          }, function(err, res) {
            return callback(err, _.get(res, 'email'));
          });
        } else {
          return callback(null, email);
        }
      },
      function(email, callback) {
        if (!email) {
          console.log('Chiquita won\'t report to ' + user + ' because the e-mail address is unknown');

          return callback();
        }
        return chiquita._send(email, { issues: output[user] });
      }
    ], callback);
  }, function (err) {
    if (err) {
      return console.log(err);
    }
  });
}

chiquita._send = function(to, data) {
  var transporter = nodemailer.createTransport(this.options.transporter);
  var defaultEmail = new EmailTemplate(path.join(__dirname, 'emails', 'default'));

  return defaultEmail.render(data, function (err, result) {
    transporter.sendMail(_.extend(chiquita.options.mail, {
      to: to
    }, result), function (err, info){
      if (err){
        return console.log(err);
      }
      console.log('Message sent: ' + info.response);
    });
  });
}

module.exports = chiquita;